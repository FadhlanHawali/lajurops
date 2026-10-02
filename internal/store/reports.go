package store

import (
	"context"
	"slices"
	"sort"
	"strings"
	"time"
)

// Workload summarises one user's assigned daily and hourly work in a period
// (project tasks are containers and are not counted). Shared tasks count
// fully for every owner. A task counts
// toward the period its start_at falls in (created_at when unscheduled).
// Hourly hours are the time a user spent on hourly work: overlapping tasks
// (support done in parallel) count once. A task covers start_at..end_at, or
// start_at plus actual_hours when recorded; an unscheduled task adds its
// actual_hours on its own.
type Workload struct {
	UserID      string  `json:"user_id"`
	Username    string  `json:"username"`
	DisplayName string  `json:"display_name"`
	Email       string  `json:"email"`
	TotalTasks  int     `json:"total_tasks"`
	DoneTasks   int     `json:"done_tasks"`
	HourlyTasks int     `json:"hourly_tasks"`
	HourlyHours float64 `json:"hourly_hours"`
	DailyTasks  int     `json:"daily_tasks"`
	DailyDone   int     `json:"daily_done"`
	LoggedHours float64 `json:"logged_hours"`
	// Deleted/Active describe the account; inactive and deleted users are
	// only listed when they have tasks in the period.
	Deleted bool `json:"deleted"`
	Active  bool `json:"active"`
}

func (s *Store) WorkloadReport(ctx context.Context, from, to time.Time, workspaceID string) ([]Workload, error) {
	rows, err := s.db.Query(ctx, `
		SELECT u.id::text, u.username, u.display_name, u.email,
		       count(t.id),
		       count(t.id) FILTER (WHERE t.status = 'done'),
		       count(t.id) FILTER (WHERE t.type = 'hourly'),
		       coalesce(sum(coalesce(t.actual_hours::float8,
		                    extract(epoch FROM (t.end_at - t.start_at)) / 3600))
		                FILTER (WHERE t.type = 'hourly'), 0),
		       count(t.id) FILTER (WHERE t.type = 'daily'),
		       count(t.id) FILTER (WHERE t.type = 'daily' AND t.status = 'done'),
		       coalesce(sum(t.actual_hours::float8), 0),
		       u.deleted_at IS NOT NULL, u.active
		FROM users u
		LEFT JOIN task_assignees ta ON ta.user_id = u.id
		LEFT JOIN tasks t
		       ON t.id = ta.task_id
		      AND coalesce(t.start_at, t.created_at) >= $1
		      AND coalesce(t.start_at, t.created_at) <  $2
		      AND ($3 = '' OR t.workspace_id::text = $3)
		      AND t.type <> 'project'
		GROUP BY u.id
		HAVING (u.active AND u.deleted_at IS NULL) OR count(t.id) > 0
		ORDER BY 8 DESC, 5 DESC, lower(u.username)`,
		from, to, workspaceID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Workload{}
	for rows.Next() {
		var w Workload
		if err := rows.Scan(&w.UserID, &w.Username, &w.DisplayName, &w.Email,
			&w.TotalTasks, &w.DoneTasks, &w.HourlyTasks, &w.HourlyHours,
			&w.DailyTasks, &w.DailyDone, &w.LoggedHours, &w.Deleted, &w.Active); err != nil {
			return nil, err
		}
		out = append(out, w)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	hours, err := s.hourlyHours(ctx, from, to, workspaceID)
	if err != nil {
		return nil, err
	}
	for i := range out {
		out[i].HourlyHours = hours[out[i].UserID]
	}
	sort.SliceStable(out, func(i, j int) bool {
		a, b := out[i], out[j]
		if a.HourlyHours != b.HourlyHours {
			return a.HourlyHours > b.HourlyHours
		}
		if a.TotalTasks != b.TotalTasks {
			return a.TotalTasks > b.TotalTasks
		}
		return strings.ToLower(a.Username) < strings.ToLower(b.Username)
	})
	return out, nil
}

// span is the time an hourly task occupies.
type span struct{ start, end time.Time }

// hourlyHours returns each user's hourly support hours in the period, with
// overlapping tasks merged (see Workload).
func (s *Store) hourlyHours(ctx context.Context, from, to time.Time, workspaceID string) (map[string]float64, error) {
	rows, err := s.db.Query(ctx, `
		SELECT ta.user_id::text, t.start_at, t.end_at, t.actual_hours::float8
		FROM task_assignees ta
		JOIN tasks t ON t.id = ta.task_id
		WHERE t.type = 'hourly'
		  AND coalesce(t.start_at, t.created_at) >= $1
		  AND coalesce(t.start_at, t.created_at) <  $2
		  AND ($3 = '' OR t.workspace_id::text = $3)`,
		from, to, workspaceID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	spans := map[string][]span{}
	loose := map[string]float64{} // hours with no time slot to merge
	for rows.Next() {
		var user string
		var start, end *time.Time
		var actual *float64
		if err := rows.Scan(&user, &start, &end, &actual); err != nil {
			return nil, err
		}
		switch {
		case start != nil && actual != nil:
			spans[user] = append(spans[user], span{*start, start.Add(time.Duration(*actual * float64(time.Hour)))})
		case start != nil && end != nil && end.After(*start):
			spans[user] = append(spans[user], span{*start, *end})
		case actual != nil:
			loose[user] += *actual
		}
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	out := loose
	for user, list := range spans {
		out[user] += mergedHours(list)
	}
	return out, nil
}

// mergedHours is the length of the union of spans, so time covered by
// several tasks at once counts once.
func mergedHours(spans []span) float64 {
	slices.SortFunc(spans, func(a, b span) int { return a.start.Compare(b.start) })
	var total time.Duration
	var cur span
	for i, sp := range spans {
		switch {
		case i == 0:
			cur = sp
		case !sp.start.After(cur.end): // overlaps or touches the current block
			if sp.end.After(cur.end) {
				cur.end = sp.end
			}
		default:
			total += cur.end.Sub(cur.start)
			cur = sp
		}
	}
	if len(spans) > 0 {
		total += cur.end.Sub(cur.start)
	}
	return total.Hours()
}

// WorkloadTasks lists the tasks counted for a user in WorkloadReport.
func (s *Store) WorkloadTasks(ctx context.Context, userID string, from, to time.Time, workspaceID string) ([]Task, error) {
	rows, err := s.db.Query(ctx, `SELECT `+taskCols+taskFrom+`
		WHERE EXISTS (SELECT 1 FROM task_assignees a WHERE a.task_id = t.id AND a.user_id = $1)
		  AND coalesce(t.start_at, t.created_at) >= $2
		  AND coalesce(t.start_at, t.created_at) <  $3
		  AND ($4 = '' OR t.workspace_id::text = $4)
		  AND t.type <> 'project'
		ORDER BY coalesce(t.start_at, t.created_at)`, userID, from, to, workspaceID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Task{}
	for rows.Next() {
		t, err := scanTask(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, t)
	}
	return out, rows.Err()
}
