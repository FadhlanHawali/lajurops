package store

import (
	"context"
	"encoding/json"
	"fmt"
	"testing"
	"time"
)

func TestProjectCategoriesAndDerivedStatus(t *testing.T) {
	st, pool := testStore(t)
	ctx := context.Background()
	suffix := fmt.Sprint(time.Now().UnixNano())
	key, key2 := "PC"+suffix[len(suffix)-6:], "PD"+suffix[len(suffix)-6:]
	ws, err := st.CreateWorkspace(ctx, WorkspaceInput{Key: key, Name: "cats"}, "")
	if err != nil {
		t.Fatal(err)
	}
	other, _ := st.CreateWorkspace(ctx, WorkspaceInput{Key: key2, Name: "other"}, "")
	t.Cleanup(func() { pool.Exec(ctx, `DELETE FROM workspaces WHERE key = ANY($1)`, []string{key, key2, key + "X"}) })

	cats, _ := st.ListCategories(ctx, ws.ID)
	if len(cats) != 3 || cats[0].Name != "KPI Project" || cats[2].Name != "Ad Hoc Project" {
		t.Fatalf("default categories = %+v", cats)
	}
	otherCats, _ := st.ListCategories(ctx, other.ID)

	mk := func(in TaskInput) Task {
		t.Helper()
		in.WorkspaceID = ws.ID
		task, err := st.CreateTask(ctx, in, "")
		if err != nil {
			t.Fatalf("%s: %v", in.Title, err)
		}
		return task
	}
	patch := func(id string, v map[string]any) (Task, error) {
		raw := map[string]json.RawMessage{}
		for k, x := range v {
			b, _ := json.Marshal(x)
			raw[k] = b
		}
		return st.UpdateTask(ctx, id, raw)
	}
	status := func(id string) (string, int) {
		t.Helper()
		task, err := st.GetTask(ctx, id)
		if err != nil {
			t.Fatal(err)
		}
		return task.Status, task.Progress
	}

	proj := mk(TaskInput{Title: "P", Type: "project", ProjectCategoryID: &cats[1].ID})
	if proj.ProjectCategoryName == nil || *proj.ProjectCategoryName != "Enhancement Project" {
		t.Fatalf("category not set: %+v", proj.ProjectCategoryName)
	}
	if _, err := patch(proj.ID, map[string]any{"project_category_id": otherCats[0].ID}); err == nil {
		t.Fatal("category from another workspace should be rejected")
	}
	d1 := mk(TaskInput{Title: "d1", Type: "daily", ParentID: &proj.ID})
	h1 := mk(TaskInput{Title: "h1", Type: "hourly", ParentID: &d1.ID})
	if _, err := patch(d1.ID, map[string]any{"project_category_id": cats[0].ID}); err == nil {
		t.Fatal("category on a daily task should be rejected")
	}

	if s, p := status(proj.ID); s != "todo" || p != 0 {
		t.Fatalf("new project = %s %d%%", s, p)
	}
	patch(h1.ID, map[string]any{"status": "in_progress"})
	if s, p := status(proj.ID); s != "in_progress" || p != 0 {
		t.Fatalf("after start = %s %d%%", s, p)
	}
	patch(h1.ID, map[string]any{"status": "done"})
	if s, p := status(proj.ID); s != "in_progress" || p != 50 {
		t.Fatalf("after 1 of 2 done = %s %d%%", s, p)
	}
	// Finishing every task doesn't close the project: done is set by hand.
	patch(d1.ID, map[string]any{"status": "done"})
	if s, p := status(proj.ID); s != "in_progress" || p != 100 {
		t.Fatalf("all tasks done = %s %d%%, want in_progress 100%%", s, p)
	}
	patch(proj.ID, map[string]any{"status": "done"})
	if s, p := status(proj.ID); s != "done" || p != 100 {
		t.Fatalf("closed by hand = %s %d%%", s, p)
	}
	if task, _ := st.GetTask(ctx, proj.ID); task.CompletedAt == nil {
		t.Error("a closed project should have a completion time")
	}
	// A closed project stays closed when work is added to it...
	d2 := mk(TaskInput{Title: "d2", Type: "daily", ParentID: &proj.ID})
	if s, p := status(proj.ID); s != "done" || p != 67 {
		t.Fatalf("after adding a task = %s %d%%", s, p)
	}
	// ...until it is reopened, which derives its status from its tasks again.
	patch(proj.ID, map[string]any{"status": "todo"})
	if s, _ := status(proj.ID); s != "in_progress" {
		t.Fatalf("reopened = %s, want in_progress", s)
	}
	if task, _ := st.GetTask(ctx, proj.ID); task.CompletedAt != nil {
		t.Error("a reopened project shouldn't keep its completion time")
	}
	patch(d2.ID, map[string]any{"parent_id": nil})
	if s, p := status(proj.ID); s != "in_progress" || p != 100 {
		t.Fatalf("after moving out = %s %d%%", s, p)
	}
	st.DeleteTask(ctx, d1.ID)
	if s, p := status(proj.ID); s != "todo" || p != 0 {
		t.Fatalf("after deleting its tasks = %s %d%%", s, p)
	}

	// Deleting a category uncategorizes its projects.
	if _, err := st.SetCategories(ctx, ws.ID, []CategoryInput{{ID: cats[0].ID, Name: "KPI", Color: "violet"}, {Name: "Maintenance", Color: "teal"}}); err != nil {
		t.Fatal(err)
	}
	if p, _ := st.GetTask(ctx, proj.ID); p.ProjectCategoryID != nil {
		t.Fatal("project should be uncategorized after its category was removed")
	}

	// Backups keep categories.
	patch(proj.ID, map[string]any{"project_category_id": cats[0].ID})
	doc, _ := st.ExportWorkspaceData(ctx, ws.ID, "")
	res, err := st.ImportWorkspaceData(ctx, doc, ImportOptions{Key: key + "X"})
	if err != nil {
		t.Fatal(err)
	}
	restored, _ := st.ListTasks(ctx, TaskFilter{WorkspaceID: res.Workspace.ID, Types: []string{"project"}})
	if len(restored) != 1 || restored[0].ProjectCategoryName == nil || *restored[0].ProjectCategoryName != "KPI" {
		t.Fatalf("restored project category = %+v", restored)
	}
}
