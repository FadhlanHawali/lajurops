package store

import (
	"context"
	"encoding/json"
	"fmt"
	"slices"
	"testing"
	"time"
)

func TestNotifications(t *testing.T) {
	st, pool := testStore(t)
	ctx := context.Background()
	suffix := fmt.Sprint(time.Now().UnixNano())
	key := "NT" + suffix[len(suffix)-5:]
	ws, err := st.CreateWorkspace(ctx, WorkspaceInput{Key: key, Name: "notifications"}, "")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { pool.Exec(ctx, `DELETE FROM workspaces WHERE key = $1`, key) })
	user := func(name string) User {
		u, err := st.UpsertUser(ctx, "itest-nt-"+name+"-"+suffix, name+suffix, "", name)
		if err != nil {
			t.Fatal(err)
		}
		t.Cleanup(func() { pool.Exec(ctx, `DELETE FROM users WHERE id = $1`, u.ID) })
		return u
	}
	owner, actor, other, outsider := user("owner"), user("actor"), user("other"), user("outsider")

	// What a person has, as "type:task title" (newest first), and unread count.
	inbox := func(u User) ([]string, []Notification) {
		t.Helper()
		list, _, err := st.Notifications(ctx, u.ID, nil, 100)
		if err != nil {
			t.Fatal(err)
		}
		out := []string{}
		for _, n := range list {
			title := ""
			if n.Task != nil {
				title = n.Task.Title
			}
			out = append(out, n.Type+":"+title)
		}
		return out, list
	}
	clear := func(users ...User) {
		for _, u := range users {
			pool.Exec(ctx, `DELETE FROM notifications WHERE user_id = $1`, u.ID)
		}
	}
	patch := func(by User, id string, v map[string]any) Task {
		t.Helper()
		raw := map[string]json.RawMessage{}
		for k, x := range v {
			b, _ := json.Marshal(x)
			raw[k] = b
		}
		task, err := st.UpdateTaskBy(ctx, by.ID, id, raw)
		if err != nil {
			t.Fatal(err)
		}
		return task
	}

	// Creating a task for someone tells them; your own tasks don't.
	project, _ := st.CreateTask(ctx, TaskInput{WorkspaceID: ws.ID, Title: "Platform", Type: "project", AssigneeIDs: []string{owner.ID}}, actor.ID)
	start := time.Date(2026, 10, 12, 0, 0, 0, 0, time.UTC)
	end := start.AddDate(0, 0, 2)
	daily, _ := st.CreateTask(ctx, TaskInput{WorkspaceID: ws.ID, ParentID: &project.ID, Title: "Prepare", Type: "daily",
		AssigneeIDs: []string{owner.ID, actor.ID}, StartAt: &start, EndAt: &end}, actor.ID)
	if got, _ := inbox(owner); fmt.Sprint(got) != "[assigned:Prepare assigned:Platform]" {
		t.Errorf("owner after creation = %v", got)
	}
	if got, _ := inbox(actor); len(got) != 0 {
		t.Errorf("actor notified about their own tasks: %v", got)
	}

	// Owners added and removed.
	clear(owner)
	patch(actor, daily.ID, map[string]any{"assignee_ids": []string{actor.ID, other.ID}})
	if got, _ := inbox(other); fmt.Sprint(got) != "[assigned:Prepare]" {
		t.Errorf("added owner = %v", got)
	}
	if got, _ := inbox(owner); fmt.Sprint(got) != "[unassigned:Prepare]" {
		t.Errorf("removed owner = %v", got)
	}
	patch(actor, daily.ID, map[string]any{"assignee_ids": []string{actor.ID, other.ID, owner.ID}})

	// Rescheduling twice and a comment, close together, make one grouped row.
	clear(owner, other)
	later, laterEnd := start.AddDate(0, 0, 1), end.AddDate(0, 0, 1)
	patch(actor, daily.ID, map[string]any{"start_at": later, "end_at": laterEnd})
	patch(actor, daily.ID, map[string]any{"end_at": laterEnd.AddDate(0, 0, 1)})
	c, err := st.CreateComment(ctx, daily.ID, actor.ID, "Moved it, see `the plan`")
	if err != nil {
		t.Fatal(err)
	}
	st.NotifyComment(ctx, c, func(string, string) bool { return true })
	got, list := inbox(other)
	if fmt.Sprint(got) != "[changes:Prepare]" {
		t.Fatalf("grouped = %v", got)
	}
	var data struct {
		Changes []map[string]any `json:"changes"`
	}
	json.Unmarshal(list[0].Data, &data)
	if len(data.Changes) != 3 || data.Changes[2]["kind"] != "comment" || data.Changes[2]["excerpt"] != "Moved it, see …" {
		t.Errorf("changes = %+v", data.Changes)
	}
	if list[0].ActorName == nil || *list[0].ActorName != "actor" || fmt.Sprint(list[0].Task.Path) != "[Platform]" {
		t.Errorf("actor %v, path %v", list[0].ActorName, list[0].Task.Path)
	}

	// A type someone switched off isn't delivered.
	if err := st.SaveNotificationSettings(ctx, owner.ID, NotificationSettings{Disabled: []string{NotifyRescheduled}, HourlyLead: 15, StepLead: 10}); err != nil {
		t.Fatal(err)
	}
	clear(owner)
	patch(actor, daily.ID, map[string]any{"start_at": start})
	if got, _ := inbox(owner); len(got) != 0 {
		t.Errorf("switched-off type delivered: %v", got)
	}
	if err := st.SaveNotificationSettings(ctx, owner.ID, NotificationSettings{Disabled: []string{"nope"}, HourlyLead: 15, StepLead: 10}); err == nil {
		t.Error("unknown type accepted")
	}
	st.SaveNotificationSettings(ctx, owner.ID, NotificationSettings{HourlyLead: 15, StepLead: 10, TZ: "Asia/Jakarta"})

	// Comments reach owners and earlier commenters; @mentions reach people
	// who can see the task, once (as a mention).
	clear(owner, other, actor)
	body := fmt.Sprintf("@%s and @%s please check (not `@%s` or mail%s@x.io)", other.Username, outsider.Username, owner.Username, owner.Username)
	if names := MentionedUsernames(body); fmt.Sprint(names) != fmt.Sprintf("[%s %s]", other.Username, outsider.Username) {
		t.Errorf("mentions = %v", names)
	}
	c2, _ := st.CreateComment(ctx, daily.ID, owner.ID, body)
	st.NotifyComment(ctx, c2, func(uid, _ string) bool { return uid != outsider.ID })
	if got, _ := inbox(other); fmt.Sprint(got) != "[mention:Prepare]" {
		t.Errorf("mentioned = %v", got)
	}
	if got, _ := inbox(actor); fmt.Sprint(got) != "[comment:Prepare]" {
		t.Errorf("owner/commenter = %v", got)
	}
	if got, _ := inbox(outsider); len(got) != 0 {
		t.Errorf("someone who can't see the task was notified: %v", got)
	}

	// Finishing what others wait for unblocks them; finishing every task in
	// a project tells its owners it's ready to close.
	clear(owner, other, actor)
	hs, he := start.Add(9*time.Hour), start.Add(10*time.Hour)
	release, _ := st.CreateTask(ctx, TaskInput{WorkspaceID: ws.ID, ParentID: &project.ID, Title: "Release", Type: "hourly",
		AssigneeIDs: []string{other.ID}, StartAt: &hs, EndAt: &he}, other.ID)
	if err := st.AddDependency(ctx, release.ID, daily.ID); err != nil {
		t.Fatal(err)
	}
	patch(actor, daily.ID, map[string]any{"status": "done"})
	if got, _ := inbox(other); fmt.Sprint(got) != "[unblocked:Release]" {
		t.Errorf("unblocked = %v", got)
	}
	patch(actor, release.ID, map[string]any{"status": "done"})
	if got, _ := inbox(owner); !slices.Contains(got, "project_ready:Platform") {
		t.Errorf("project ready = %v", got)
	}

	// Reading and marking read.
	_, unread, _ := st.Notifications(ctx, owner.ID, nil, 100)
	if unread == 0 {
		t.Fatal("no unread notifications")
	}
	if _, n, _ := st.Notifications(ctx, owner.ID, []string{}, 100); n != 0 {
		t.Errorf("notifications outside the caller's workspaces counted: %d", n)
	}
	_, items := inbox(owner)
	st.MarkNotificationsRead(ctx, owner.ID, []string{items[0].ID})
	if n, _ := st.UnreadNotifications(ctx, owner.ID, nil); n != unread-1 {
		t.Errorf("after marking one read: %d, want %d", n, unread-1)
	}
	st.MarkNotificationsRead(ctx, owner.ID, nil)
	if n, _ := st.UnreadNotifications(ctx, owner.ID, nil); n != 0 {
		t.Errorf("after marking all read: %d", n)
	}

	// Reminders: an hourly task and a runbook step starting soon, once each.
	clear(owner, other, actor)
	now := time.Date(2026, 10, 12, 1, 0, 0, 0, time.UTC) // Monday 08:00 in Jakarta
	soon, soonEnd := now.Add(12*time.Minute), now.Add(72*time.Minute)
	window, _ := st.CreateTask(ctx, TaskInput{WorkspaceID: ws.ID, Title: "Window", Type: "hourly", AssigneeIDs: []string{owner.ID}, StartAt: &soon, EndAt: &soonEnd}, owner.ID)
	sec, _ := st.AddRunbookSection(ctx, window.ID, "Prep")
	stepTitle := "Back up"
	stepAt, _ := json.Marshal(now.Add(8 * time.Minute))
	st.AddRunbookStep(ctx, sec.ID, RunbookStepInput{Title: &stepTitle, StartAt: stepAt})
	late, _ := json.Marshal(now.Add(40 * time.Minute))
	lateTitle := "Later"
	st.AddRunbookStep(ctx, sec.ID, RunbookStepInput{Title: &lateTitle, StartAt: late})
	r := st.NewReminders()
	count := func(typ string) int {
		got, _ := inbox(owner)
		n := 0
		for _, g := range got {
			if g == typ {
				n++
			}
		}
		return n
	}
	r.Tick(ctx, now)
	r.Tick(ctx, now.Add(time.Minute))
	if count("hourly_soon:Window") != 1 || count("step_soon:Window") != 1 {
		got, _ := inbox(owner)
		t.Errorf("reminders (once each, only the step within 10 min) = %v", got)
	}
	// A step's daily task due today (in the owner's zone), from 09:00 local.
	dueStart, dueEnd := time.Date(2026, 10, 11, 17, 0, 0, 0, time.UTC), time.Date(2026, 10, 12, 17, 0, 0, 0, time.UTC) // Mon Oct 12 in Jakarta
	prep, _ := st.CreateTask(ctx, TaskInput{WorkspaceID: ws.ID, Title: "Prep scripts", Type: "daily", AssigneeIDs: []string{owner.ID}, StartAt: &dueStart, EndAt: &dueEnd}, owner.ID)
	pool.Exec(ctx, `UPDATE runbook_steps SET task_id = $1 WHERE title = $2 AND section_id = $3`, prep.ID, lateTitle, sec.ID)
	r.Tick(ctx, now) // 08:00 local: too early
	if count("step_task_due:Prep scripts") != 0 {
		t.Error("step task reminder before 09:00")
	}
	r.Tick(ctx, now.Add(90*time.Minute)) // 09:30
	r.Tick(ctx, now.Add(95*time.Minute))
	if count("step_task_due:Prep scripts") != 1 {
		t.Errorf("step task due: %d, want 1", count("step_task_due:Prep scripts"))
	}

	// Monday 10:00 local: work this week but no commitment shared.
	r.Tick(ctx, now.Add(3*time.Hour)) // 11:00 Jakarta
	r.Tick(ctx, now.Add(3*time.Hour+time.Minute))
	if count("commitment_unshared:") != 1 || count("step_task_due:Prep scripts") != 1 || count("hourly_soon:Window") != 1 {
		got, _ := inbox(owner)
		t.Errorf("monday reminder (and nothing repeated) = %v", got)
	}
}

// With several replicas only one runs the reminders, and another takes
// over when it stops.
func TestRemindersOneLeader(t *testing.T) {
	st, _ := testStore(t)
	ctx := context.Background()
	a, b := st.NewReminders(), st.NewReminders()
	defer a.Resign()
	defer b.Resign()
	if !a.Lead(ctx) {
		t.Fatal("the first replica didn't take the lead")
	}
	if !a.Lead(ctx) {
		t.Error("the leader lost the lead on its next minute")
	}
	if b.Lead(ctx) {
		t.Fatal("two replicas lead at once")
	}
	a.Resign()
	if !b.Lead(ctx) {
		t.Error("nobody took over after the leader stopped")
	}
	if a.Lead(ctx) {
		t.Error("the old leader took the lead back while another holds it")
	}
}
