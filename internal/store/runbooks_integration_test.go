package store

import (
	"context"
	"encoding/json"
	"fmt"
	"testing"
	"time"
)

func TestRunbooksAndTemplates(t *testing.T) {
	st, pool := testStore(t)
	ctx := context.Background()
	suffix := fmt.Sprint(time.Now().UnixNano())
	key, other := "RB"+suffix[len(suffix)-6:], "RC"+suffix[len(suffix)-6:]
	ws, err := st.CreateWorkspace(ctx, WorkspaceInput{Key: key, Name: "runbooks"}, "")
	if err != nil {
		t.Fatal(err)
	}
	ws2, _ := st.CreateWorkspace(ctx, WorkspaceInput{Key: other, Name: "other"}, "")
	t.Cleanup(func() { pool.Exec(ctx, `DELETE FROM workspaces WHERE key = ANY($1)`, []string{key, other}) })
	user, _ := st.UpsertUser(ctx, "itest-rb-"+suffix, "rb"+suffix, "", "RB")
	t.Cleanup(func() { pool.Exec(ctx, `DELETE FROM users WHERE id = $1`, user.ID) })

	start := time.Date(2026, 10, 9, 13, 0, 0, 0, time.UTC)
	end := start.Add(3 * time.Hour)
	task, err := st.CreateTask(ctx, TaskInput{WorkspaceID: ws.ID, Title: "Release", Type: "hourly", StartAt: &start, EndAt: &end}, "")
	if err != nil {
		t.Fatal(err)
	}
	raw := func(v any) *json.RawMessage { b, _ := json.Marshal(v); m := json.RawMessage(b); return &m }
	str := func(s string) *string { return &s }

	prep, err := st.AddRunbookSection(ctx, task.ID, "Preparation")
	if err != nil {
		t.Fatal(err)
	}
	impl, _ := st.AddRunbookSection(ctx, task.ID, "Implementation")
	if _, err := st.AddRunbookSection(ctx, task.ID, "  "); err == nil {
		t.Error("blank section name accepted")
	}
	// Two days before at 14:00 UTC for 2 hours; and one without a time.
	s1, err := st.AddRunbookStep(ctx, prep.ID, RunbookStepInput{Title: str("Dry run on Staging"), StartAt: raw(start.Add(-47 * time.Hour)), DurationMinutes: raw(120)})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := st.AddRunbookStep(ctx, prep.ID, RunbookStepInput{Title: str("Get sign-off")}); err != nil {
		t.Fatal(err)
	}
	if _, err := st.AddRunbookStep(ctx, impl.ID, RunbookStepInput{Title: str("Deploy"), StartAt: raw(start), DurationMinutes: raw(30)}); err != nil {
		t.Fatal(err)
	}
	if _, err := st.AddRunbookStep(ctx, impl.ID, RunbookStepInput{Title: str("x"), DurationMinutes: raw(0)}); err == nil {
		t.Error("duration 0 accepted")
	}

	// Ticking records who and when; unticking clears it.
	done, err := st.UpdateRunbookStep(ctx, s1.ID, user.ID, RunbookStepInput{Done: ptrBool(true)})
	if err != nil || !done.Done || done.DoneAt == nil || done.DoneBy == nil || *done.DoneBy != user.ID {
		t.Fatalf("tick: %+v %v", done, err)
	}
	got, _ := st.GetTask(ctx, task.ID)
	if got.RunbookTotal != 3 || got.RunbookDone != 1 {
		t.Errorf("task counts = %d/%d, want 1/3", got.RunbookDone, got.RunbookTotal)
	}

	// Markdown notes on a step and a section.
	notes := "Run:\n```bash\n./migrate up\n```"
	if _, err := st.UpdateRunbookStep(ctx, s1.ID, user.ID, RunbookStepInput{Notes: &notes}); err != nil {
		t.Fatal(err)
	}
	prereq := "Needs VPN"
	if err := st.UpdateRunbookSection(ctx, prep.ID, nil, &prereq); err != nil {
		t.Fatal(err)
	}

	// Order: Implementation first.
	if err := st.OrderRunbookSections(ctx, task.ID, []string{impl.ID, prep.ID}); err != nil {
		t.Fatal(err)
	}
	rb, _ := st.Runbook(ctx, task.ID)
	if len(rb) != 2 || rb[0].Name != "Implementation" || len(rb[1].Steps) != 2 || rb[1].Steps[1].Title != "Get sign-off" {
		t.Fatalf("runbook = %+v", rb)
	}

	// Save as a template: times become offsets from the task start.
	tpl, err := st.SaveRunbookTemplate(ctx, task.ID, "Production deploy", user.ID)
	if err != nil {
		t.Fatal(err)
	}
	if tpl.StepCount != 3 || *tpl.Sections[1].Steps[0].OffsetMinutes != -47*60 || tpl.Sections[1].Steps[1].OffsetMinutes != nil {
		t.Errorf("template = %+v", tpl.Sections)
	}
	// Same name (any case) replaces it.
	if again, err := st.SaveRunbookTemplate(ctx, task.ID, "production DEPLOY", user.ID); err != nil || again.ID != tpl.ID {
		t.Errorf("re-save: %v %v", again.ID, err)
	}

	// Apply to a task a week later: steps shift with it, unticked.
	later := start.Add(7 * 24 * time.Hour)
	laterEnd := later.Add(3 * time.Hour)
	task2, err := st.CreateTask(ctx, TaskInput{WorkspaceID: ws.ID, Title: "Next release", Type: "hourly", StartAt: &later, EndAt: &laterEnd}, "")
	if err != nil {
		t.Fatal(err)
	}
	if err := st.ApplyRunbookTemplate(ctx, task2.ID, tpl.ID, user.ID, ""); err != nil {
		t.Fatal(err)
	}
	rb2, _ := st.Runbook(ctx, task2.ID)
	if len(rb2) != 2 || len(rb2[1].Steps) != 2 || rb2[1].Steps[0].Done || !rb2[1].Steps[0].StartAt.Equal(later.Add(-47*time.Hour)) || rb2[1].Steps[1].StartAt != nil {
		t.Fatalf("applied runbook = %+v", rb2)
	}
	// Notes travel with the template; the section keeps its name.
	if rb2[1].Notes != prereq || rb2[1].Steps[0].Notes != notes || rb2[1].Name != "Preparation" {
		t.Errorf("notes not applied: section %q, step %q", rb2[1].Notes, rb2[1].Steps[0].Notes)
	}

	// Templates stay in their workspace.
	task3, _ := st.CreateTask(ctx, TaskInput{WorkspaceID: ws2.ID, Title: "elsewhere", Type: "hourly"}, "")
	if err := st.ApplyRunbookTemplate(ctx, task3.ID, tpl.ID, user.ID, ""); err == nil {
		t.Error("template applied across workspaces")
	}
	if list, _ := st.RunbookTemplates(ctx, ws2.ID); len(list) != 0 {
		t.Errorf("other workspace sees %d templates", len(list))
	}

	// Deleting a section removes its steps.
	if err := st.DeleteRunbookSection(ctx, prep.ID); err != nil {
		t.Fatal(err)
	}
	got, _ = st.GetTask(ctx, task.ID)
	if got.RunbookTotal != 1 {
		t.Errorf("after deleting a section: %d steps, want 1", got.RunbookTotal)
	}
}

func ptrBool(b bool) *bool { return &b }

// Runbooks are for hourly tasks; a step can be tracked as a daily task.
func TestRunbookStepTasks(t *testing.T) {
	st, pool := testStore(t)
	ctx := context.Background()
	suffix := fmt.Sprint(time.Now().UnixNano())
	key := "RT" + suffix[len(suffix)-6:]
	ws, err := st.CreateWorkspace(ctx, WorkspaceInput{Key: key, Name: "step tasks"}, "")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { pool.Exec(ctx, `DELETE FROM workspaces WHERE key = $1`, key) })
	user, _ := st.UpsertUser(ctx, "itest-rt-"+suffix, "rt"+suffix, "", "RT")
	t.Cleanup(func() { pool.Exec(ctx, `DELETE FROM users WHERE id = $1`, user.ID) })
	str := func(s string) *string { return &s }

	project, _ := st.CreateTask(ctx, TaskInput{WorkspaceID: ws.ID, Title: "Platform", Type: "project"}, "")
	daily, _ := st.CreateTask(ctx, TaskInput{WorkspaceID: ws.ID, ParentID: &project.ID, Title: "A daily", Type: "daily"}, "")
	if _, err := st.AddRunbookSection(ctx, daily.ID, "Preparation"); err == nil {
		t.Error("runbook added to a daily task")
	}
	start := time.Date(2026, 10, 9, 13, 0, 0, 0, time.UTC)
	end := start.Add(2 * time.Hour)
	release, err := st.CreateTask(ctx, TaskInput{WorkspaceID: ws.ID, ParentID: &project.ID, Title: "Release", Type: "hourly", StartAt: &start, EndAt: &end, AssigneeIDs: []string{user.ID}}, "")
	if err != nil {
		t.Fatal(err)
	}
	prep, err := st.AddRunbookSection(ctx, release.ID, "Preparation")
	if err != nil {
		t.Fatal(err)
	}
	step, _ := st.AddRunbookStep(ctx, prep.ID, RunbookStepInput{Title: str("Prepare rollback scripts"), Notes: str("see wiki")})

	// The daily task lands on the day in the user's zone, under the project,
	// with the release's owners; the release waits for it.
	if _, err := st.MakeStepTask(ctx, step.ID, user.ID, StepTaskInput{Day: "2026-10-08", TZ: "Nowhere/City"}); err == nil {
		t.Error("unknown time zone accepted")
	}
	taskID, err := st.MakeStepTask(ctx, step.ID, user.ID, StepTaskInput{Day: "2026-10-08", TZ: "Asia/Jakarta"})
	if err != nil {
		t.Fatal(err)
	}
	prepTask, _ := st.GetTask(ctx, taskID)
	wantStart := time.Date(2026, 10, 7, 17, 0, 0, 0, time.UTC)
	if prepTask.Type != "daily" || prepTask.ParentID == nil || *prepTask.ParentID != project.ID || prepTask.Description != "see wiki" ||
		!prepTask.StartAt.Equal(wantStart) || !prepTask.EndAt.Equal(wantStart.Add(24*time.Hour)) ||
		len(prepTask.AssigneeIDs) != 1 || prepTask.AssigneeIDs[0] != user.ID {
		t.Fatalf("daily task = %+v", prepTask)
	}
	if rel, _ := st.GetTask(ctx, release.ID); len(rel.BlockedBy) != 1 || rel.BlockedBy[0] != taskID {
		t.Errorf("release waits for %v, want the daily task", rel.BlockedBy)
	}
	if _, err := st.MakeStepTask(ctx, step.ID, user.ID, StepTaskInput{}); err == nil {
		t.Error("step made a task twice")
	}

	// Ticking the step completes the task, and the other way round.
	stepState := func() RunbookStep {
		rb, _ := st.Runbook(ctx, release.ID)
		return rb[0].Steps[0]
	}
	if s := stepState(); s.Task == nil || s.Task.ID != taskID || s.Done || !s.StartAt.Equal(wantStart) {
		t.Fatalf("linked step = %+v", s)
	}
	if _, err := st.UpdateRunbookStep(ctx, step.ID, user.ID, RunbookStepInput{Done: ptrBool(true)}); err != nil {
		t.Fatal(err)
	}
	if got, _ := st.GetTask(ctx, taskID); got.Status != "done" {
		t.Errorf("task status after ticking = %s", got.Status)
	}
	if rel, _ := st.GetTask(ctx, release.ID); rel.RunbookDone != 1 || rel.RunbookTotal != 1 {
		t.Errorf("counts = %d/%d, want 1/1", rel.RunbookDone, rel.RunbookTotal)
	}
	if _, err := st.UpdateTask(ctx, taskID, map[string]json.RawMessage{"status": json.RawMessage(`"in_progress"`), "title": json.RawMessage(`"Prepare rollback (v2)"`)}); err != nil {
		t.Fatal(err)
	}
	if s := stepState(); s.Done || s.Title != "Prepare rollback (v2)" {
		t.Errorf("step after reopening the task = %+v", s)
	}

	// Runbooks stay on hourly tasks.
	if _, err := st.UpdateTask(ctx, release.ID, map[string]json.RawMessage{"type": json.RawMessage(`"daily"`)}); err == nil {
		t.Error("task with a runbook changed to daily")
	}

	// Templates remember steps tracked as tasks and create new ones.
	tpl, err := st.SaveRunbookTemplate(ctx, release.ID, "Release", user.ID)
	if err != nil || !tpl.Sections[0].Steps[0].AsTask {
		t.Fatalf("template = %+v %v", tpl.Sections, err)
	}
	later, laterEnd := start.AddDate(0, 0, 7), end.AddDate(0, 0, 7)
	release2, _ := st.CreateTask(ctx, TaskInput{WorkspaceID: ws.ID, ParentID: &project.ID, Title: "Release 2", Type: "hourly", StartAt: &later, EndAt: &laterEnd}, "")
	if err := st.ApplyRunbookTemplate(ctx, release2.ID, tpl.ID, user.ID, "Asia/Jakarta"); err != nil {
		t.Fatal(err)
	}
	rb2, _ := st.Runbook(ctx, release2.ID)
	if s := rb2[0].Steps[0]; s.Task == nil || s.Task.ID == taskID || !s.StartAt.Equal(wantStart.AddDate(0, 0, 7)) {
		t.Fatalf("applied step = %+v", s)
	}

	// Unlinking keeps the task and turns the step into a checklist item.
	if err := st.UnlinkStepTask(ctx, step.ID); err != nil {
		t.Fatal(err)
	}
	if s := stepState(); s.Task != nil || s.Title != "Prepare rollback (v2)" || s.Done {
		t.Errorf("unlinked step = %+v", s)
	}
	if _, err := st.GetTask(ctx, taskID); err != nil {
		t.Errorf("task gone after unlinking: %v", err)
	}
	// Deleting a linked task leaves the step as a checklist item.
	if err := st.DeleteTask(ctx, rb2[0].Steps[0].Task.ID); err != nil {
		t.Fatal(err)
	}
	if rb2, _ = st.Runbook(ctx, release2.ID); len(rb2[0].Steps) != 1 || rb2[0].Steps[0].Task != nil {
		t.Errorf("after deleting the task: %+v", rb2[0].Steps)
	}
}
