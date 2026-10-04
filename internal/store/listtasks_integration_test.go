package store

import (
	"context"
	"fmt"
	"slices"
	"testing"
	"time"
)

// ListTasks with a date range, undated tasks and ancestors, as the board and
// timeline use it.
func TestListTasksRangeUndatedAncestors(t *testing.T) {
	st, pool := testStore(t)
	ctx := context.Background()
	suffix := fmt.Sprint(time.Now().UnixNano())
	key := "LT" + suffix[len(suffix)-6:]
	ws, err := st.CreateWorkspace(ctx, WorkspaceInput{Key: key, Name: "list"}, "")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { pool.Exec(ctx, `DELETE FROM workspaces WHERE key = $1`, key) })

	day := func(d int) *time.Time { v := time.Date(2026, 3, d, 0, 0, 0, 0, time.UTC); return &v }
	mk := func(title, typ string, parent *string, start, end *time.Time, status string) string {
		t.Helper()
		task, err := st.CreateTask(ctx, TaskInput{WorkspaceID: ws.ID, ParentID: parent, Title: title, Type: typ, Status: status, StartAt: start, EndAt: end}, "")
		if err != nil {
			t.Fatalf("%s: %v", title, err)
		}
		return task.ID
	}
	project := mk("project (no dates)", "project", nil, nil, nil, "")
	daily := mk("daily, before the range", "daily", &project, day(1), day(3), "")
	mk("hourly in range", "hourly", &daily, day(10), day(10), "")
	mk("daily in range", "daily", &project, day(9), day(12), "")
	mk("daily after the range", "daily", nil, day(20), day(21), "")
	mk("undated, open", "daily", nil, nil, nil, "")
	mk("undated, done", "daily", nil, nil, nil, "done")
	mk("only an end date, in range", "daily", nil, nil, day(11), "")

	titles := func(f TaskFilter) []string {
		t.Helper()
		f.WorkspaceID = ws.ID
		f.From, f.To = day(8), day(15)
		list, err := st.ListTasks(ctx, f)
		if err != nil {
			t.Fatal(err)
		}
		var out []string
		for _, x := range list {
			out = append(out, x.Title)
		}
		slices.Sort(out)
		return out
	}
	expect := func(name string, got []string, want ...string) {
		t.Helper()
		slices.Sort(want)
		if !slices.Equal(got, want) {
			t.Errorf("%s:\n got  %q\n want %q", name, got, want)
		}
	}

	expect("range only", titles(TaskFilter{}), "daily in range", "hourly in range", "only an end date, in range")
	expect("undated=open", titles(TaskFilter{Undated: "open"}),
		"daily in range", "hourly in range", "only an end date, in range", "undated, open", "project (no dates)")
	expect("undated=all", titles(TaskFilter{Undated: "all"}),
		"daily in range", "hourly in range", "only an end date, in range", "undated, open", "undated, done", "project (no dates)")
	// The hourly task's daily parent is outside the range, and the project has no dates: ancestors bring both.
	expect("ancestors", titles(TaskFilter{WithAncestors: true}),
		"daily in range", "hourly in range", "only an end date, in range", "daily, before the range", "project (no dates)")
	if _, err := st.ListTasks(ctx, TaskFilter{WorkspaceID: ws.ID, Undated: "bogus"}); err == nil {
		t.Error("undated=bogus accepted")
	}
}
