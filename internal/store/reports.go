package store

import (
	"context"
	"time"
)

// Workload summarises one user's assigned daily and hourly work in a period
// (project tasks are containers and are not counted). Shared tasks count
// fully for every owner. A task counts
// toward the period its start_at falls in (created_at when unscheduled).
// Hourly hours use actual_hours when recorded, otherwise the scheduled
// duration (end_at - start_at).
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
		       coalesce(sum(t.actual_hours::float8), 0)
		FROM users u
		LEFT JOIN task_assignees ta ON ta.user_id = u.id
		LEFT JOIN tasks t
		       ON t.id = ta.task_id
		      AND coalesce(t.start_at, t.created_at) >= $1
		      AND coalesce(t.start_at, t.created_at) <  $2
		      AND ($3 = '' OR t.workspace_id::text = $3)
		      AND t.type <> 'project'
		GROUP BY u.id
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
			&w.DailyTasks, &w.DailyDone, &w.LoggedHours); err != nil {
			return nil, err
		}
		out = append(out, w)
	}
	return out, rows.Err()
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
