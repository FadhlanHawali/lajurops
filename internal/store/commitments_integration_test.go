package store

import (
	"context"
	"errors"
	"fmt"
	"testing"
	"time"
)

func TestCommitments(t *testing.T) {
	st, pool := testStore(t)
	ctx := context.Background()
	suffix := fmt.Sprint(time.Now().UnixNano())
	key := "CM" + suffix[len(suffix)-6:]
	ws, err := st.CreateWorkspace(ctx, WorkspaceInput{Key: key, Name: "commitments"}, "")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { pool.Exec(ctx, `DELETE FROM workspaces WHERE key = $1`, key) })
	me, err := st.UpsertUser(ctx, "cm-me-"+suffix, "cm-me-"+suffix, "", "")
	if err != nil {
		t.Fatal(err)
	}
	other, err := st.UpsertUser(ctx, "cm-other-"+suffix, "cm-other-"+suffix, "", "")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { pool.Exec(ctx, `DELETE FROM users WHERE id = ANY($1::uuid[])`, []string{me.ID, other.ID}) })

	zone := time.FixedZone("WIB", 7*3600)
	prev := time.Date(2026, 9, 28, 0, 0, 0, 0, zone)
	week := prev.AddDate(0, 0, 7)
	at := func(day time.Time, d, h int) *time.Time {
		v := day.AddDate(0, 0, d).Add(time.Duration(h) * time.Hour)
		return &v
	}

	mk := func(title, typ, owner string, parent *string, start, end *time.Time) string {
		t.Helper()
		task, err := st.CreateTask(ctx, TaskInput{WorkspaceID: ws.ID, ParentID: parent, Title: title, Type: typ, AssigneeIDs: []string{owner}, StartAt: start, EndAt: end}, "")
		if err != nil {
			t.Fatalf("%s: %v", title, err)
		}
		return task.ID
	}
	project := mk("project", "project", me.ID, nil, nil, nil)
	a := mk("a", "daily", me.ID, nil, nil, nil)
	inner := mk("inner", "daily", me.ID, &project, nil, nil)
	// Hourly tasks in the week are committed automatically; these two
	// overlap by an hour, so they take 3h, not 4h.
	h1 := mk("h1", "hourly", me.ID, &inner, at(week, 1, 9), at(week, 1, 11))
	h2 := mk("h2", "hourly", me.ID, nil, at(week, 1, 10), at(week, 1, 12))
	unscheduled := mk("unscheduled", "hourly", me.ID, nil, nil, nil)
	lastWeek := mk("last week", "hourly", me.ID, nil, at(prev, 2, 9), at(prev, 2, 10))
	mk("next week", "hourly", me.ID, nil, at(week, 7, 9), at(week, 7, 10))
	theirs := mk("theirs", "daily", other.ID, nil, nil, nil)
	mk("their hourly", "hourly", other.ID, nil, at(week, 2, 9), at(week, 2, 10))

	scope := Scope{ws.ID}
	mine := func(w time.Time) Commitment {
		t.Helper()
		list, err := st.Commitments(ctx, w, scope, me.ID, false)
		if err != nil || len(list) != 1 {
			t.Fatalf("commitments: %v (%d)", err, len(list))
		}
		return list[0]
	}
	ids := func(c Commitment) (out []string) {
		for _, x := range c.Tasks {
			out = append(out, x.ID)
		}
		return out
	}

	c := mine(week)
	if c.UpdatedAt != nil || c.CapacityHours != DefaultCapacityHours {
		t.Errorf("before saving: %+v", c)
	}
	if got := ids(c); fmt.Sprint(got) != fmt.Sprint([]string{h1, h2}) || !c.Tasks[0].Automatic || c.HourlyHours != 3 {
		t.Errorf("automatic hourly tasks: %v, %v hours", got, c.HourlyHours)
	}
	if c.Tasks[0].ProjectID == nil || *c.Tasks[0].ProjectID != project || c.Tasks[1].ProjectID != nil {
		t.Errorf("projects: %v, %v", c.Tasks[0].ProjectID, c.Tasks[1].ProjectID)
	}

	if err := st.SaveCommitment(ctx, me.ID, week.Add(time.Hour), CommitmentInput{}, scope, scope); !errors.Is(err, ErrInvalid) {
		t.Errorf("not a week start: %v", err)
	}
	for name, id := range map[string]string{"a project": project, "an hourly task": unscheduled} {
		if err := st.SaveCommitment(ctx, me.ID, week, CommitmentInput{TaskIDs: []string{id}}, scope, scope); !errors.Is(err, ErrInvalid) {
			t.Errorf("picking %s: %v", name, err)
		}
	}
	if err := st.SaveCommitment(ctx, me.ID, week, CommitmentInput{TaskIDs: []string{a}}, Scope{}, Scope{}); !errors.Is(err, ErrInvalid) {
		t.Errorf("picking outside scope: %v", err)
	}

	// Last week: a (done in time) and the hourly task (still open).
	if err := st.SaveCommitment(ctx, me.ID, prev, CommitmentInput{TaskIDs: []string{a}}, scope, scope); err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, `UPDATE tasks SET status = 'done', completed_at = $2 WHERE id = $1`, a, prev.AddDate(0, 0, 3)); err != nil {
		t.Fatal(err)
	}
	capacity := 24.0
	if err := st.SaveCommitment(ctx, me.ID, week, CommitmentInput{CapacityHours: &capacity, Note: "hi", TaskIDs: []string{inner, a, inner}}, scope, scope); err != nil {
		t.Fatal(err)
	}
	c = mine(week)
	if c.Week != "2026-10-05" || c.CapacityHours != 24 || c.Note != "hi" || c.UpdatedAt == nil {
		t.Errorf("saved commitment: %+v", c)
	}
	if got := ids(c); fmt.Sprint(got) != fmt.Sprint([]string{inner, a, h1, h2}) || c.Tasks[0].Automatic {
		t.Errorf("picked daily tasks first, in order, then hourly: %v", got)
	}
	if c.PrevTotal != 2 || c.PrevKept != 1 || len(c.CarriedOver) != 1 || c.CarriedOver[0] != lastWeek {
		t.Errorf("last week: total %d kept %d carried %v", c.PrevTotal, c.PrevKept, c.CarriedOver)
	}
	// Overdue: last week's open hourly task (a was done, so it isn't).
	if len(c.Overdue) != 1 || c.Overdue[0].ID != lastWeek || c.Overdue[0].CommittedWeek != "2026-09-28" || !c.Overdue[0].Automatic {
		t.Errorf("overdue: %+v", c.Overdue)
	}
	// A daily task picked last week, still open and picked again this week, isn't overdue.
	if _, err := pool.Exec(ctx, `UPDATE tasks SET status = 'todo', completed_at = NULL WHERE id = $1`, a); err != nil {
		t.Fatal(err)
	}
	if c := mine(week); len(c.Overdue) != 1 {
		t.Errorf("a is committed again this week, so only one overdue task: %d", len(c.Overdue))
	}
	// Seen from next week: a, inner, h1, h2 (this week) and last week's hourly task.
	if c := mine(week.AddDate(0, 0, 7)); len(c.Overdue) != 5 {
		t.Errorf("overdue seen from next week: %d, want 5", len(c.Overdue))
	}
	if _, err := pool.Exec(ctx, `UPDATE tasks SET status = 'done', completed_at = $2 WHERE id = $1`, a, prev.AddDate(0, 0, 3)); err != nil {
		t.Fatal(err)
	}

	// Saving with a smaller scope keeps the picks the caller can't see.
	if err := st.SaveCommitment(ctx, me.ID, week, CommitmentInput{}, Scope{}, Scope{}); err != nil {
		t.Fatal(err)
	}
	if c := mine(week); len(c.Tasks) != 4 {
		t.Errorf("picks outside scope were dropped: %d tasks left", len(c.Tasks))
	}

	// The team list includes people who haven't saved, with their hourly work.
	list, err := st.Commitments(ctx, week, scope, "", true)
	if err != nil {
		t.Fatal(err)
	}
	found := false
	full := mine(week)
	for _, x := range list {
		if x.UserID == me.ID {
			b := x.Brief()
			if fmt.Sprint(ids(x)) != fmt.Sprint(ids(full)) || len(b.Tasks) != len(full.Tasks) || b.Tasks[0].Key != full.Tasks[0].Key || b.Tasks[0].Title != full.Tasks[0].Title || x.HourlyHours != full.HourlyHours {
				t.Errorf("lite and full commitments differ:\n lite %+v\n full %+v", b, full)
			}
		}
		if x.UserID == other.ID {
			found = x.UpdatedAt == nil && len(x.Tasks) == 1 && x.Tasks[0].Automatic && x.HourlyHours == 1
		}
	}
	if !found {
		t.Error("the other user should be listed with their hourly task")
	}

	// Picking scheduled the unscheduled task a for the week it was picked
	// (last week, Monday to Friday) and left later picks alone.
	task, err := st.GetTask(ctx, a)
	if err != nil {
		t.Fatal(err)
	}
	if task.StartAt == nil || !task.StartAt.Equal(prev) || task.EndAt == nil || !task.EndAt.Equal(prev.AddDate(0, 0, 5)) {
		t.Errorf("a should be scheduled Mon-Fri of last week: %v - %v", task.StartAt, task.EndAt)
	}

	// An unassigned daily task can be picked where the user can edit, which
	// assigns it to them and schedules it.
	free, err := st.CreateTask(ctx, TaskInput{WorkspaceID: ws.ID, Title: "free", Type: "daily"}, "")
	if err != nil {
		t.Fatal(err)
	}
	if err := st.SaveCommitment(ctx, me.ID, week, CommitmentInput{TaskIDs: []string{free.ID}}, scope, Scope{}); !errors.Is(err, ErrInvalid) {
		t.Errorf("picking an unassigned task without edit access: %v", err)
	}
	if err := st.SaveCommitment(ctx, me.ID, week, CommitmentInput{TaskIDs: []string{free.ID}}, scope, scope); err != nil {
		t.Fatal(err)
	}
	if task, err = st.GetTask(ctx, free.ID); err != nil {
		t.Fatal(err)
	}
	if fmt.Sprint(task.AssigneeIDs) != fmt.Sprint([]string{me.ID}) || task.StartAt == nil || !task.StartAt.Equal(week) {
		t.Errorf("picked unassigned task: owners %v, start %v", task.AssigneeIDs, task.StartAt)
	}
	unassigned, err := st.ListTasks(ctx, TaskFilter{WorkspaceID: ws.ID, AssigneeID: "none"})
	if err != nil {
		t.Fatal(err)
	}
	for _, x := range unassigned {
		if len(x.AssigneeIDs) > 0 {
			t.Errorf("assignee_id=none returned %s, which has owners", x.Title)
		}
	}

	// Someone else's daily task: listed for me under "others", refused
	// without edit access, and picking it adds me next to its owner.
	others, err := st.ListTasks(ctx, TaskFilter{WorkspaceID: ws.ID, OthersOf: me.ID, Types: []string{"daily"}})
	if err != nil {
		t.Fatal(err)
	}
	if len(others) != 1 || others[0].ID != theirs {
		t.Errorf("others should list only their daily task: %d tasks", len(others))
	}
	if err := st.SaveCommitment(ctx, me.ID, week, CommitmentInput{TaskIDs: []string{theirs}}, scope, Scope{}); !errors.Is(err, ErrInvalid) {
		t.Errorf("picking someone else's task without edit access: %v", err)
	}
	if err := st.SaveCommitment(ctx, me.ID, week, CommitmentInput{TaskIDs: []string{theirs, free.ID}}, scope, scope); err != nil {
		t.Fatal(err)
	}
	if task, err = st.GetTask(ctx, theirs); err != nil {
		t.Fatal(err)
	}
	if fmt.Sprint(task.AssigneeIDs) != fmt.Sprint([]string{other.ID, me.ID}) {
		t.Errorf("picked shared task should keep its owner and add me: %v", task.AssigneeIDs)
	}
	if others, _ = st.ListTasks(ctx, TaskFilter{WorkspaceID: ws.ID, OthersOf: me.ID, Types: []string{"daily"}}); len(others) != 0 {
		t.Errorf("once I'm an owner, it isn't someone else's any more: %d tasks", len(others))
	}
}

// Short daily tasks (at most AutoDailyMaxDays) are committed automatically
// in the week they are due.
func TestAutoDailyCommitments(t *testing.T) {
	st, pool := testStore(t)
	ctx := context.Background()
	suffix := fmt.Sprint(time.Now().UnixNano())
	key := "AD" + suffix[len(suffix)-6:]
	ws, err := st.CreateWorkspace(ctx, WorkspaceInput{Key: key, Name: "auto daily"}, "")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { pool.Exec(ctx, `DELETE FROM workspaces WHERE key = $1`, key) })
	me, _ := st.UpsertUser(ctx, "ad-me-"+suffix, "ad-me-"+suffix, "", "")
	other, _ := st.UpsertUser(ctx, "ad-other-"+suffix, "ad-other-"+suffix, "", "")
	t.Cleanup(func() { pool.Exec(ctx, `DELETE FROM users WHERE id = ANY($1::uuid[])`, []string{me.ID, other.ID}) })

	zone := time.FixedZone("WIB", 7*3600)
	week := time.Date(2026, 10, 5, 0, 0, 0, 0, zone) // Monday
	prev := week.AddDate(0, 0, -7)
	day := func(d int) *time.Time { v := week.AddDate(0, 0, d); return &v }
	// Daily tasks run from the start of their first day to the midnight after the last.
	mk := func(title, owner string, first, last int, dated bool) string {
		t.Helper()
		in := TaskInput{WorkspaceID: ws.ID, Title: title, Type: "daily", AssigneeIDs: []string{owner}}
		if dated {
			in.StartAt, in.EndAt = day(first), day(last+1)
		}
		task, err := st.CreateTask(ctx, in, "")
		if err != nil {
			t.Fatalf("%s: %v", title, err)
		}
		return task.ID
	}
	short := mk("Mon-Wed", me.ID, 0, 2, true)
	crossing := mk("Fri-Tue", me.ID, -3, 1, true) // due this week
	week7 := mk("Sun-Sat", me.ID, -1, 5, true)    // exactly 7 days
	mk("12 days", me.ID, -7, 4, true)             // too long: picked by hand
	mk("Sat-Tue", me.ID, 5, 8, true)              // due next week
	mk("undated", me.ID, 0, 0, false)
	mk("theirs", other.ID, 0, 2, true)
	picked := mk("Thu-Fri, picked", me.ID, 3, 4, true)
	lastWeek := mk("last week, open", me.ID, -5, -3, true)
	keptLastWeek := mk("last week, done", me.ID, -7, -6, true)
	if _, err := pool.Exec(ctx, `UPDATE tasks SET status = 'done', completed_at = $2 WHERE id = $1`, keptLastWeek, prev.AddDate(0, 0, 2)); err != nil {
		t.Fatal(err)
	}
	scope := Scope{ws.ID}
	if err := st.SaveCommitment(ctx, me.ID, week, CommitmentInput{TaskIDs: []string{picked}}, scope, scope); err != nil {
		t.Fatal(err)
	}

	list, err := st.Commitments(ctx, week, scope, me.ID, false)
	if err != nil || len(list) != 1 {
		t.Fatalf("commitments: %v", err)
	}
	c := list[0]
	got := map[string]bool{} // id -> automatic
	for _, x := range c.Tasks {
		if _, dup := got[x.ID]; dup {
			t.Errorf("%s listed twice", x.Title)
		}
		got[x.ID] = x.Automatic
	}
	want := map[string]bool{picked: false, short: true, crossing: true, week7: true}
	if fmt.Sprint(got) != fmt.Sprint(want) {
		t.Errorf("this week's tasks (id: automatic) = %v, want %v", got, want)
	}
	if c.HourlyHours != 0 {
		t.Errorf("daily tasks don't add hourly hours: %v", c.HourlyHours)
	}
	// Last week: both short tasks due then were committed; one was kept.
	if c.PrevTotal != 2 || c.PrevKept != 1 || fmt.Sprint(c.CarriedOver) != fmt.Sprint([]string{lastWeek}) {
		t.Errorf("last week: total %d kept %d carried %v", c.PrevTotal, c.PrevKept, c.CarriedOver)
	}
	// ...and the open one is overdue, for the week it was due.
	if len(c.Overdue) != 1 || c.Overdue[0].ID != lastWeek || !c.Overdue[0].Automatic || c.Overdue[0].CommittedWeek != "2026-09-28" {
		t.Errorf("overdue: %+v", c.Overdue)
	}
	// The crossing task belongs only to the week it is due in.
	if list, _ := st.Commitments(ctx, prev, scope, me.ID, true); len(list) == 1 {
		for _, x := range list[0].Tasks {
			if x.ID == crossing {
				t.Error("Fri-Tue task also committed in the week it starts")
			}
		}
	}
	// Another person's short task is theirs, not mine; they're listed with it.
	team, _ := st.Commitments(ctx, week, scope, "", true)
	for _, x := range team {
		if x.UserID == other.ID && (len(x.Tasks) != 1 || !x.Tasks[0].Automatic) {
			t.Errorf("other user's tasks: %+v", x.Tasks)
		}
	}
}
