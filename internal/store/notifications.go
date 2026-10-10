package store

import (
	"context"
	"encoding/json"
	"log/slog"
	"regexp"
	"slices"
	"strings"
	"time"
)

// Notification types (the bell). People never get notified about their
// own actions; reminders are sent once (see dedupe keys).
const (
	NotifyAssigned           = "assigned"            // you were made an owner
	NotifyUnassigned         = "unassigned"          // you were removed as an owner
	NotifyRescheduled        = "rescheduled"         // your task's dates changed
	NotifyComment            = "comment"             // a comment on a task you own or commented on
	NotifyMention            = "mention"             // you were @mentioned in a comment
	NotifyUnblocked          = "unblocked"           // a task you wait for is done
	NotifyHourlySoon         = "hourly_soon"         // your hourly task starts soon
	NotifyStepSoon           = "step_soon"           // your runbook step starts soon
	NotifyStepTaskDue        = "step_task_due"       // a step's daily task is due today
	NotifyCommitmentUnshared = "commitment_unshared" // Monday: this week's commitment isn't shared
	NotifyCommitmentOverdue  = "commitment_overdue"  // Monday: committed tasks are overdue
	NotifyProjectReady       = "project_ready"       // all tasks of your project are done
	// NotifyChanges is a grouped row: several rescheduled/comment events.
	NotifyChanges = "changes"
)

// NotificationTypes are the types a person can switch off.
var NotificationTypes = set(NotifyAssigned, NotifyUnassigned, NotifyRescheduled, NotifyComment, NotifyMention,
	NotifyUnblocked, NotifyHourlySoon, NotifyStepSoon, NotifyStepTaskDue, NotifyCommitmentUnshared,
	NotifyCommitmentOverdue, NotifyProjectReady)

// groupWindow: events by the same person on the same task this close
// together (and still unread) are merged into one notification.
const groupWindow = 30 * time.Minute

// NotificationRetention is how long notifications are kept.
const NotificationRetention = 60 * 24 * time.Hour

// Notification is one row of the bell's list, with the task it's about.
type Notification struct {
	ID        string          `json:"id"`
	Type      string          `json:"type"`
	Data      json.RawMessage `json:"data"`
	CreatedAt time.Time       `json:"created_at"`
	UpdatedAt time.Time       `json:"updated_at"`
	Read      bool            `json:"read"`
	ActorID   *string         `json:"actor_id"`
	ActorName *string         `json:"actor_name"`
	Task      *NotifiedTask   `json:"task"`
}

// NotifiedTask is what the list shows of a notification's task.
type NotifiedTask struct {
	ID     string   `json:"id"`
	Key    string   `json:"key"`
	Title  string   `json:"title"`
	Type   string   `json:"type"`
	Status string   `json:"status"`
	Path   []string `json:"path"` // its project and daily parent, outermost first
}

// notice is one event to deliver to some people.
type notice struct {
	users   []string
	typ     string
	taskID  string
	actorID string
	data    map[string]any
	dedupe  string
	// change makes the notice groupable: it's appended to data.changes of a
	// recent unread notification from the same actor on the same task.
	change map[string]any
}

// notify delivers a notice, skipping the actor, inactive people and those
// who switched the type off. Errors are logged, not returned: notifications
// must never make the change they describe fail.
func (s *Store) notify(ctx context.Context, n notice) {
	if err := s.deliver(ctx, n); err != nil {
		slog.Error("notification", "type", n.typ, "task", n.taskID, "err", err)
	}
}

func (s *Store) deliver(ctx context.Context, n notice) error {
	if len(n.users) == 0 {
		return nil
	}
	rows, err := s.db.Query(ctx, `
		SELECT u.id::text FROM users u LEFT JOIN notification_settings ns ON ns.user_id = u.id
		WHERE u.id::text = ANY($1) AND u.active AND u.deleted_at IS NULL AND u.id::text <> $2
		  AND NOT ($3 = ANY (coalesce(ns.disabled, '{}')))`, n.users, n.actorID, n.typ)
	if err != nil {
		return err
	}
	var to []string
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			rows.Close()
			return err
		}
		to = append(to, id)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return err
	}
	data := n.data
	if data == nil {
		data = map[string]any{}
	}
	if n.change != nil {
		data["changes"] = []any{n.change}
	}
	body, err := json.Marshal(data)
	if err != nil {
		return err
	}
	change, _ := json.Marshal([]any{n.change})
	for _, uid := range to {
		if n.change != nil && n.taskID != "" && n.actorID != "" {
			tag, err := s.db.Exec(ctx, `
				UPDATE notifications SET
				    type = CASE WHEN type = $5 THEN type ELSE 'changes' END,
				    data = jsonb_set(data, '{changes}', coalesce(data->'changes', '[]') || $6::jsonb),
				    updated_at = now()
				WHERE user_id = $1 AND task_id = $2 AND actor_id = $3 AND read_at IS NULL
				  AND type IN ('rescheduled', 'comment', 'changes') AND updated_at > now() - $4::interval`,
				uid, n.taskID, n.actorID, groupWindow.String(), n.typ, string(change))
			if err != nil {
				return err
			}
			if tag.RowsAffected() > 0 {
				continue
			}
		}
		if _, err := s.db.Exec(ctx, `
			INSERT INTO notifications (user_id, type, task_id, actor_id, data, dedupe_key)
			VALUES ($1, $2, $3, $4, $5, $6)
			ON CONFLICT (user_id, dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING`,
			uid, n.typ, nullIfEmpty(n.taskID), nullIfEmpty(n.actorID), string(body), nullIfEmpty(n.dedupe)); err != nil {
			return err
		}
	}
	return nil
}

func taskRef(t Task) map[string]any {
	return map[string]any{"id": t.ID, "key": t.Key, "title": t.Title}
}

func sameTime(a, b *time.Time) bool {
	return (a == nil) == (b == nil) && (a == nil || a.Equal(*b))
}

func minus(a, b []string) []string {
	var out []string
	for _, x := range a {
		if !slices.Contains(b, x) {
			out = append(out, x)
		}
	}
	return out
}

// notifyCreated tells a new task's owners (other than whoever created it)
// that it's theirs.
func (s *Store) notifyCreated(ctx context.Context, actorID string, t Task) {
	s.notify(ctx, notice{users: t.AssigneeIDs, typ: NotifyAssigned, taskID: t.ID, actorID: actorID})
}

// UpdateTaskBy is UpdateTask on behalf of actorID, notifying the people the
// change concerns (owners added or removed, dates moved, work unblocked,
// a project whose tasks are now all done).
func (s *Store) UpdateTaskBy(ctx context.Context, actorID, id string, patch map[string]json.RawMessage) (Task, error) {
	before, err := s.GetTask(ctx, id)
	if err != nil {
		return Task{}, err
	}
	after, err := s.UpdateTask(ctx, id, patch)
	if err != nil {
		return after, err
	}
	added := minus(after.AssigneeIDs, before.AssigneeIDs)
	s.notify(ctx, notice{users: added, typ: NotifyAssigned, taskID: id, actorID: actorID})
	s.notify(ctx, notice{users: minus(before.AssigneeIDs, after.AssigneeIDs), typ: NotifyUnassigned, taskID: id, actorID: actorID})
	if !sameTime(before.StartAt, after.StartAt) || !sameTime(before.EndAt, after.EndAt) {
		s.notify(ctx, notice{users: minus(after.AssigneeIDs, added), typ: NotifyRescheduled, taskID: id, actorID: actorID,
			change: map[string]any{"kind": NotifyRescheduled, "type": after.Type,
				"from": []any{before.StartAt, before.EndAt}, "to": []any{after.StartAt, after.EndAt}}})
	}
	if before.Status != "done" && after.Status == "done" && after.Type != "project" {
		s.notifyDone(ctx, actorID, after)
	}
	return after, nil
}

// notifyDone handles a task becoming done: owners of tasks that waited
// only on unfinished work that's now all done, and owners of its project
// when every task in it is done (and the project isn't closed yet).
func (s *Store) notifyDone(ctx context.Context, actorID string, t Task) {
	rows, err := s.db.Query(ctx, `
		SELECT w.id::text, (SELECT coalesce(array_agg(a.user_id::text), '{}') FROM task_assignees a WHERE a.task_id = w.id)
		FROM task_dependencies d JOIN tasks w ON w.id = d.task_id
		WHERE d.depends_on_id = $1 AND w.status <> 'done'
		  AND NOT EXISTS (SELECT 1 FROM task_dependencies d2 JOIN tasks b ON b.id = d2.depends_on_id
		                  WHERE d2.task_id = w.id AND b.status <> 'done')`, t.ID)
	if err != nil {
		slog.Error("notification: unblocked", "err", err)
		return
	}
	type waiting struct {
		id     string
		owners []string
	}
	var list []waiting
	for rows.Next() {
		var x waiting
		if rows.Scan(&x.id, &x.owners) == nil {
			list = append(list, x)
		}
	}
	rows.Close()
	for _, x := range list {
		s.notify(ctx, notice{users: x.owners, typ: NotifyUnblocked, taskID: x.id, actorID: actorID, data: map[string]any{"blocker": taskRef(t)}})
	}

	var project string
	var owners []string
	var total int
	err = s.db.QueryRow(ctx, `
		WITH p AS (
			SELECT CASE WHEN p1.type = 'project' THEN p1.id WHEN p2.type = 'project' THEN p2.id END AS id
			FROM tasks t LEFT JOIN tasks p1 ON p1.id = t.parent_id LEFT JOIN tasks p2 ON p2.id = p1.parent_id
			WHERE t.id = $1
		), d AS (
			SELECT c.status FROM p JOIN tasks c ON c.parent_id = p.id
			UNION ALL
			SELECT g.status FROM p JOIN tasks c ON c.parent_id = p.id JOIN tasks g ON g.parent_id = c.id
		)
		SELECT pr.id::text, (SELECT coalesce(array_agg(a.user_id::text), '{}') FROM task_assignees a WHERE a.task_id = pr.id),
		       (SELECT count(*) FROM d)
		FROM p JOIN tasks pr ON pr.id = p.id
		WHERE pr.status <> 'done' AND (SELECT count(*) FROM d) > 0 AND NOT EXISTS (SELECT 1 FROM d WHERE status <> 'done')`,
		t.ID).Scan(&project, &owners, &total)
	if err != nil {
		return // no project, or not all done yet
	}
	s.notify(ctx, notice{users: owners, typ: NotifyProjectReady, taskID: project, actorID: actorID,
		data: map[string]any{"total": total}, dedupe: NotifyProjectReady + ":" + project + ":" + time.Now().UTC().Format(time.DateOnly)})
}

// --- comments and @mentions ---

var (
	mentionRe  = regexp.MustCompile(`(?:^|[^\w@./-])@([A-Za-z0-9][A-Za-z0-9._-]*)`)
	codeRe     = regexp.MustCompile("(?s)```.*?```|`[^`\n]*`")
	markdownRe = regexp.MustCompile("[*_`>#~\\[\\]]+|\\]\\([^)]*\\)")
)

// MentionedUsernames lists the usernames @mentioned in a comment (outside
// code), lowercased, once each.
func MentionedUsernames(body string) []string {
	var out []string
	for _, m := range mentionRe.FindAllStringSubmatch(codeRe.ReplaceAllString(body, " "), -1) {
		name := strings.ToLower(strings.TrimRight(m[1], ".-_"))
		if name != "" && !slices.Contains(out, name) {
			out = append(out, name)
		}
	}
	return out
}

// excerpt is a short plain-text preview of a comment.
func excerpt(body string) string {
	s := strings.Join(strings.Fields(markdownRe.ReplaceAllString(codeRe.ReplaceAllString(body, " … "), "")), " ")
	if r := []rune(s); len(r) > 140 {
		return string(r[:139]) + "…"
	}
	return s
}

// NotifyComment tells people about a new comment: @mentioned people who
// can see the task (canSee decides) get a mention; its owners and earlier
// commenters get a comment notification.
func (s *Store) NotifyComment(ctx context.Context, c Comment, canSee func(userID, workspaceID string) bool) {
	var ws string
	var owners, commenters []string
	err := s.db.QueryRow(ctx, `
		SELECT t.workspace_id::text,
		       (SELECT coalesce(array_agg(a.user_id::text), '{}') FROM task_assignees a WHERE a.task_id = t.id),
		       (SELECT coalesce(array_agg(DISTINCT c.author_id::text), '{}') FROM task_comments c WHERE c.task_id = t.id AND c.author_id IS NOT NULL)
		FROM tasks t WHERE t.id = $1`, c.TaskID).Scan(&ws, &owners, &commenters)
	if err != nil {
		slog.Error("notification: comment", "err", err)
		return
	}
	actor := ""
	if c.AuthorID != nil {
		actor = *c.AuthorID
	}
	text := excerpt(c.Body)
	var mentioned []string
	if names := MentionedUsernames(c.Body); len(names) > 0 {
		rows, err := s.db.Query(ctx, `SELECT id::text FROM users WHERE lower(username) = ANY($1) AND active AND deleted_at IS NULL`, names)
		if err == nil {
			for rows.Next() {
				var id string
				if rows.Scan(&id) == nil && canSee(id, ws) {
					mentioned = append(mentioned, id)
				}
			}
			rows.Close()
		}
	}
	s.notify(ctx, notice{users: mentioned, typ: NotifyMention, taskID: c.TaskID, actorID: actor,
		data: map[string]any{"excerpt": text, "comment_id": c.ID}})
	others := minus(append(owners, commenters...), mentioned)
	s.notify(ctx, notice{users: others, typ: NotifyComment, taskID: c.TaskID, actorID: actor,
		change: map[string]any{"kind": NotifyComment, "excerpt": text, "comment_id": c.ID}})
}

// UserIsAdmin reports the admin flag remembered from the user's last sign-in.
func (s *Store) UserIsAdmin(ctx context.Context, id string) bool {
	var admin bool
	_ = s.db.QueryRow(ctx, `SELECT is_admin FROM users WHERE id = $1`, id).Scan(&admin)
	return admin
}

// SetUserAdmin remembers whether a user is an admin (from their token).
func (s *Store) SetUserAdmin(ctx context.Context, id string, admin bool) error {
	_, err := s.db.Exec(ctx, `UPDATE users SET is_admin = $2 WHERE id = $1 AND is_admin <> $2`, id, admin)
	return err
}

// --- reading ---

// Notifications lists a person's notifications, newest first, with unread
// ones counted; those about tasks outside workspaceIDs (nil means all) are
// left out.
func (s *Store) Notifications(ctx context.Context, userID string, workspaceIDs []string, limit int) ([]Notification, int, error) {
	rows, err := s.db.Query(ctx, `
		SELECT n.id::text, n.type, n.data, n.created_at, n.updated_at, n.read_at IS NOT NULL,
		       n.actor_id::text, nullif(coalesce(nullif(u.display_name, ''), u.username), ''),
		       t.id::text, w.key || '-' || t.number, t.title, t.type, t.status, array_remove(ARRAY[p2.title, p1.title], NULL)
		FROM notifications n
		LEFT JOIN users u ON u.id = n.actor_id
		LEFT JOIN tasks t ON t.id = n.task_id
		LEFT JOIN workspaces w ON w.id = t.workspace_id
		LEFT JOIN tasks p1 ON p1.id = t.parent_id
		LEFT JOIN tasks p2 ON p2.id = p1.parent_id
		WHERE n.user_id = $1 AND n.updated_at > now() - $2::interval
		  AND (n.task_id IS NULL OR $3::text[] IS NULL OR t.workspace_id::text = ANY($3))
		ORDER BY n.updated_at DESC LIMIT $4`, userID, NotificationRetention.String(), workspaceIDs, limit)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()
	out := []Notification{}
	for rows.Next() {
		var n Notification
		var tid, key, title, typ, status *string
		var path []string
		if err := rows.Scan(&n.ID, &n.Type, &n.Data, &n.CreatedAt, &n.UpdatedAt, &n.Read, &n.ActorID, &n.ActorName,
			&tid, &key, &title, &typ, &status, &path); err != nil {
			return nil, 0, err
		}
		if tid != nil {
			n.Task = &NotifiedTask{ID: *tid, Key: *key, Title: *title, Type: *typ, Status: *status, Path: path}
		}
		out = append(out, n)
	}
	if err := rows.Err(); err != nil {
		return nil, 0, err
	}
	unread, err := s.UnreadNotifications(ctx, userID, workspaceIDs)
	return out, unread, err
}

// UnreadNotifications counts a person's unread notifications (see Notifications).
func (s *Store) UnreadNotifications(ctx context.Context, userID string, workspaceIDs []string) (int, error) {
	var n int
	err := s.db.QueryRow(ctx, `
		SELECT count(*) FROM notifications n LEFT JOIN tasks t ON t.id = n.task_id
		WHERE n.user_id = $1 AND n.read_at IS NULL AND n.updated_at > now() - $2::interval
		  AND (n.task_id IS NULL OR $3::text[] IS NULL OR t.workspace_id::text = ANY($3))`,
		userID, NotificationRetention.String(), workspaceIDs).Scan(&n)
	return n, err
}

// MarkNotificationsRead marks the given notifications (all when ids is nil) read.
func (s *Store) MarkNotificationsRead(ctx context.Context, userID string, ids []string) error {
	_, err := s.db.Exec(ctx, `
		UPDATE notifications SET read_at = now()
		WHERE user_id = $1 AND read_at IS NULL AND ($2::text[] IS NULL OR id::text = ANY($2))`, userID, ids)
	return err
}

// NotificationSettings are a person's choices (see notification_settings).
type NotificationSettings struct {
	Disabled   []string `json:"disabled"`
	HourlyLead int      `json:"hourly_lead"`
	StepLead   int      `json:"step_lead"`
	TZ         string   `json:"tz"`
}

func (s *Store) GetNotificationSettings(ctx context.Context, userID string) (NotificationSettings, error) {
	ns := NotificationSettings{Disabled: []string{}, HourlyLead: 15, StepLead: 10}
	err := s.db.QueryRow(ctx, `SELECT disabled, hourly_lead, step_lead, tz FROM notification_settings WHERE user_id = $1`, userID).
		Scan(&ns.Disabled, &ns.HourlyLead, &ns.StepLead, &ns.TZ)
	if err != nil && notFound(err) == ErrNotFound {
		return ns, nil
	}
	return ns, err
}

// SaveNotificationSettings stores a person's choices.
func (s *Store) SaveNotificationSettings(ctx context.Context, userID string, ns NotificationSettings) error {
	for _, t := range ns.Disabled {
		if !NotificationTypes[t] {
			return invalid("unknown notification type " + t)
		}
	}
	if ns.HourlyLead < 1 || ns.HourlyLead > 120 || ns.StepLead < 1 || ns.StepLead > 120 {
		return invalid("reminder times must be 1-120 minutes")
	}
	if _, err := loadTZ(ns.TZ); err != nil {
		return err
	}
	if ns.Disabled == nil {
		ns.Disabled = []string{}
	}
	_, err := s.db.Exec(ctx, `
		INSERT INTO notification_settings (user_id, disabled, hourly_lead, step_lead, tz) VALUES ($1, $2, $3, $4, $5)
		ON CONFLICT (user_id) DO UPDATE SET disabled = EXCLUDED.disabled, hourly_lead = EXCLUDED.hourly_lead,
		    step_lead = EXCLUDED.step_lead, tz = EXCLUDED.tz, updated_at = now()`,
		userID, ns.Disabled, ns.HourlyLead, ns.StepLead, ns.TZ)
	return err
}

// RememberTimeZone records the time zone a person's browser reports, for
// reminders at local times (only when it changed, and only valid zones).
func (s *Store) RememberTimeZone(ctx context.Context, userID, tz string) {
	if tz == "" {
		return
	}
	if _, err := loadTZ(tz); err != nil {
		return
	}
	_, _ = s.db.Exec(ctx, `
		INSERT INTO notification_settings (user_id, tz) VALUES ($1, $2)
		ON CONFLICT (user_id) DO UPDATE SET tz = EXCLUDED.tz WHERE notification_settings.tz <> EXCLUDED.tz`, userID, tz)
}
