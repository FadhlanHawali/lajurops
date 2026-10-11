package store

import (
	"context"
	"log/slog"
	"strconv"
	"sync"
	"time"
)

// Time-based notifications, made by RunReminders every minute: hourly tasks
// and runbook steps starting soon, a step's daily task due today, and the
// Monday Weekly Commitment reminders. Dedupe keys make each one fire once,
// even after a restart or with several servers.

// Reminder times in each person's zone (UTC until their browser reports one).
const (
	stepTaskDueHour   = 9  // a step's daily task due today: from 09:00
	commitmentHour    = 10 // Monday commitment reminders: from 10:00
	maxLeadMinutes    = 120
	reminderRetention = time.Hour
)

// Reminders runs the time-based notifications; one per server.
type Reminders struct {
	s *Store
	// checked remembers, per person, the week whose Monday reminders were
	// already worked out, so people with nothing due aren't recomputed every
	// minute on Mondays.
	mu        sync.Mutex
	checked   map[string]string
	lastPrune time.Time
}

func (s *Store) NewReminders() *Reminders { return &Reminders{s: s, checked: map[string]string{}} }

// Run calls Tick every minute until ctx ends.
func (r *Reminders) Run(ctx context.Context) {
	t := time.NewTicker(time.Minute)
	defer t.Stop()
	for {
		r.Tick(ctx, time.Now())
		select {
		case <-ctx.Done():
			return
		case <-t.C:
		}
	}
}

// Tick makes the reminders due at now (errors are logged).
func (r *Reminders) Tick(ctx context.Context, now time.Time) {
	for name, q := range map[string]string{"hourly soon": hourlySoonSQL, "step soon": stepSoonSQL, "step task due": stepTaskDueSQL} {
		if _, err := r.s.db.Exec(ctx, q, now, maxLeadMinutes); err != nil {
			slog.Error("reminders", "kind", name, "err", err)
		}
	}
	r.weekly(ctx, now)
	if now.Sub(r.lastPrune) > reminderRetention {
		r.lastPrune = now
		if _, err := r.s.db.Exec(ctx, `DELETE FROM notifications WHERE updated_at < $1`, now.Add(-NotificationRetention)); err != nil {
			slog.Error("reminders: prune", "err", err)
		}
	}
}

// Shared parts: active owners, their settings and whether the type is on.
const ownerJoin = `
	JOIN task_assignees a ON a.task_id = t.id
	JOIN users u ON u.id = a.user_id AND u.active AND u.deleted_at IS NULL
	LEFT JOIN notification_settings ns ON ns.user_id = a.user_id`

const insertReminder = `INSERT INTO notifications (user_id, type, task_id, data, dedupe_key) `
const onConflict = ` ON CONFLICT (user_id, dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING`

// $1 = now, $2 = the longest lead time. A rescheduled task fires again (its
// start is part of the key).
var hourlySoonSQL = insertReminder + `
	SELECT a.user_id, 'hourly_soon', t.id, jsonb_build_object('start_at', t.start_at),
	       'hourly_soon:' || t.id || ':' || extract(epoch FROM t.start_at)::bigint
	FROM tasks t` + ownerJoin + `
	WHERE t.type = 'hourly' AND t.status <> 'done'
	  AND t.start_at > $1 AND t.start_at <= $1 + make_interval(mins => $2)
	  AND t.start_at - make_interval(mins => coalesce(ns.hourly_lead, 15)) <= $1
	  AND NOT ('hourly_soon' = ANY (coalesce(ns.disabled, '{}')))` + onConflict

// Runbook steps with a time (not those tracked as daily tasks), for the
// owners of the runbook's hourly task.
var stepSoonSQL = insertReminder + `
	SELECT a.user_id, 'step_soon', t.id,
	       jsonb_build_object('step_id', st.id, 'step_title', st.title, 'start_at', st.start_at, 'section', sec.name),
	       'step_soon:' || st.id || ':' || extract(epoch FROM st.start_at)::bigint
	FROM runbook_steps st
	JOIN runbook_sections sec ON sec.id = st.section_id
	JOIN tasks t ON t.id = sec.task_id` + ownerJoin + `
	WHERE st.task_id IS NULL AND NOT st.done AND t.status <> 'done'
	  AND st.start_at > $1 AND st.start_at <= $1 + make_interval(mins => $2)
	  AND st.start_at - make_interval(mins => coalesce(ns.step_lead, 10)) <= $1
	  AND NOT ('step_soon' = ANY (coalesce(ns.disabled, '{}')))` + onConflict

// A daily task that a runbook step is tracked as, whose last day is today in
// its owner's zone, still open: from 09:00 local. ($2 is unused here.)
var stepTaskDueSQL = insertReminder + `
	SELECT a.user_id, 'step_task_due', t.id, jsonb_build_object('runbook_task', rb.id),
	       'step_task_due:' || t.id || ':' || to_char(($1::timestamptz AT TIME ZONE coalesce(nullif(ns.tz, ''), 'UTC'))::date, 'YYYY-MM-DD')
	FROM tasks t
	JOIN LATERAL (SELECT sec.task_id AS id FROM runbook_steps st JOIN runbook_sections sec ON sec.id = st.section_id
	              WHERE st.task_id = t.id LIMIT 1) rb ON true` + ownerJoin + `
	WHERE t.type = 'daily' AND t.status <> 'done' AND $2::int > 0
	  -- Ending within a day of now in any time zone (uses an index), then exactly today locally.
	  AND t.end_at > $1::timestamptz - interval '1 day' AND t.end_at <= $1::timestamptz + interval '2 days'
	  AND ((t.end_at - interval '1 second') AT TIME ZONE coalesce(nullif(ns.tz, ''), 'UTC'))::date
	      = ($1::timestamptz AT TIME ZONE coalesce(nullif(ns.tz, ''), 'UTC'))::date
	  AND extract(hour FROM $1::timestamptz AT TIME ZONE coalesce(nullif(ns.tz, ''), 'UTC')) >= ` + strconv.Itoa(stepTaskDueHour) + `
	  AND NOT ('step_task_due' = ANY (coalesce(ns.disabled, '{}')))` + onConflict

// weekly makes the Monday reminders: from 10:00 local, a person with work
// this week who hasn't shared a commitment, and one with overdue committed
// tasks.
func (r *Reminders) weekly(ctx context.Context, now time.Time) {
	rows, err := r.s.db.Query(ctx, `
		SELECT u.id::text, coalesce(ns.tz, ''), coalesce(ns.disabled, '{}')
		FROM users u LEFT JOIN notification_settings ns ON ns.user_id = u.id
		WHERE u.active AND u.deleted_at IS NULL`)
	if err != nil {
		slog.Error("reminders: weekly", "err", err)
		return
	}
	type person struct {
		id, tz   string
		disabled []string
	}
	var people []person
	for rows.Next() {
		var p person
		if rows.Scan(&p.id, &p.tz, &p.disabled) == nil {
			people = append(people, p)
		}
	}
	rows.Close()
	for _, p := range people {
		loc, err := loadTZ(p.tz)
		if err != nil {
			loc = time.UTC
		}
		local := now.In(loc)
		if local.Weekday() != time.Monday || local.Hour() < commitmentHour {
			continue
		}
		week := time.Date(local.Year(), local.Month(), local.Day(), 0, 0, 0, 0, loc)
		day := weekDate(week)
		r.mu.Lock()
		done := r.checked[p.id] == day
		r.checked[p.id] = day
		r.mu.Unlock()
		if done {
			continue
		}
		list, err := r.s.Commitments(ctx, week, nil, p.id, true)
		if err != nil || len(list) != 1 {
			continue
		}
		c := list[0]
		if c.UpdatedAt == nil && len(c.Tasks) > 0 {
			r.s.notify(ctx, notice{users: []string{p.id}, typ: NotifyCommitmentUnshared,
				data: map[string]any{"week": day, "tasks": len(c.Tasks)}, dedupe: NotifyCommitmentUnshared + ":" + day})
		}
		if len(c.Overdue) > 0 {
			r.s.notify(ctx, notice{users: []string{p.id}, typ: NotifyCommitmentOverdue,
				data: map[string]any{"week": day, "count": len(c.Overdue)}, dedupe: NotifyCommitmentOverdue + ":" + day})
		}
	}
}
