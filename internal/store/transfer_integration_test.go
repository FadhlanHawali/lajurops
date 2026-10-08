package store

import (
	"context"
	"encoding/json"
	"fmt"
	"testing"
	"time"
)

func TestExportImportRoundTrip(t *testing.T) {
	st, pool := testStore(t)
	ctx := context.Background()
	suffix := fmt.Sprint(time.Now().UnixNano())
	key := "RT" + suffix[len(suffix)-6:]
	newKey := "RI" + suffix[len(suffix)-6:]

	alice, _ := st.UpsertUser(ctx, "itest-alice-"+suffix, "alice-"+suffix, "", "Alice")
	ws, err := st.CreateWorkspace(ctx, WorkspaceInput{Key: key, Name: "Round trip"}, alice.ID)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		pool.Exec(ctx, `DELETE FROM workspaces WHERE key = ANY($1)`, []string{key, newKey})
		pool.Exec(ctx, `DELETE FROM users WHERE keycloak_sub LIKE $1`, "itest-%-"+suffix)
	})
	mk := func(in TaskInput) Task {
		in.WorkspaceID = ws.ID
		task, err := st.CreateTask(ctx, in, alice.ID)
		if err != nil {
			t.Fatalf("%s: %v", in.Title, err)
		}
		return task
	}
	proj := mk(TaskInput{Title: "Project", Type: "project", ProjectKind: ptr("long"), AssigneeIDs: []string{alice.ID}})
	envs, err := st.SetEnvironments(ctx, proj.ID, []EnvironmentInput{{Name: "Dev", Color: "green"}, {Name: "Prod", Color: "red"}})
	if err != nil {
		t.Fatal(err)
	}
	ip := mk(TaskInput{Title: "Create IP", Type: "daily", ParentID: &proj.ID, EnvironmentID: &envs[0].ID, Status: "done"})
	vm := mk(TaskInput{Title: "Create VM", Type: "daily", ParentID: &proj.ID, EnvironmentID: &envs[1].ID})
	deploy := mk(TaskInput{Title: "Deploy", Type: "hourly", ParentID: &vm.ID, AssigneeIDs: []string{alice.ID}})
	if err := st.AddDependency(ctx, vm.ID, ip.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := st.CreateComment(ctx, vm.ID, alice.ID, "**note**"); err != nil {
		t.Fatal(err)
	}

	// A runbook on the hourly task: a ticked step with notes, and a step
	// tracked as its own daily task; plus a template.
	prep, _ := st.AddRunbookSection(ctx, deploy.ID, "Preparation")
	notes := "Run `make check`"
	if err := st.UpdateRunbookSection(ctx, prep.ID, nil, &notes); err != nil {
		t.Fatal(err)
	}
	title, dur := "Back up the DB", json.RawMessage(`45`)
	backup, err := st.AddRunbookStep(ctx, prep.ID, RunbookStepInput{Title: &title, Notes: &notes, DurationMinutes: dur})
	if err != nil {
		t.Fatal(err)
	}
	done := true
	if _, err := st.UpdateRunbookStep(ctx, backup.ID, alice.ID, RunbookStepInput{Done: &done}); err != nil {
		t.Fatal(err)
	}
	title2 := "Prepare rollback"
	linked, _ := st.AddRunbookStep(ctx, prep.ID, RunbookStepInput{Title: &title2})
	if _, err := st.MakeStepTask(ctx, linked.ID, alice.ID, StepTaskInput{Day: "2026-10-08"}); err != nil {
		t.Fatal(err)
	}
	if _, err := st.SaveRunbookTemplate(ctx, deploy.ID, "Deploy", alice.ID); err != nil {
		t.Fatal(err)
	}

	doc, err := st.ExportWorkspaceData(ctx, ws.ID, "alice")
	if err != nil {
		t.Fatal(err)
	}
	if len(doc.RunbookSections) != 1 || len(doc.RunbookSteps) != 2 || len(doc.RunbookTemplates) != 1 {
		t.Fatalf("runbook export: %d sections, %d steps, %d templates", len(doc.RunbookSections), len(doc.RunbookSteps), len(doc.RunbookTemplates))
	}
	// The step's daily task is a task of its own now.
	if len(doc.Tasks) != 5 {
		t.Fatalf("export has %d tasks, want 5", len(doc.Tasks))
	}
	if len(doc.Environments) != 2 || len(doc.Dependencies) != 2 || len(doc.Comments) != 1 || len(doc.Users) != 1 {
		t.Fatalf("export counts: tasks %d envs %d deps %d comments %d users %d", len(doc.Tasks), len(doc.Environments), len(doc.Dependencies), len(doc.Comments), len(doc.Users))
	}

	// Same key is reported as taken on a dry run and refused on import.
	dry, err := st.ImportWorkspaceData(ctx, doc, ImportOptions{DryRun: true})
	if err != nil || !dry.KeyTaken || dry.Tasks != 5 {
		t.Fatalf("dry run = %+v, %v", dry, err)
	}
	if _, err := st.ImportWorkspaceData(ctx, doc, ImportOptions{}); err == nil {
		t.Fatal("import with a taken key should fail")
	}

	res, err := st.ImportWorkspaceData(ctx, doc, ImportOptions{Key: newKey, Name: "Restored"})
	if err != nil {
		t.Fatal(err)
	}
	if res.Tasks != 5 || res.Environments != 2 || res.Dependencies != 2 || res.Comments != 1 || res.Assignments != 3 ||
		res.RunbookSteps != 2 || res.RunbookTemplates != 1 || len(res.UnknownUsers) != 0 {
		t.Fatalf("import result = %+v", res)
	}
	tasks, _ := st.ListTasks(ctx, TaskFilter{WorkspaceID: res.Workspace.ID})
	byTitle := map[string]Task{}
	for _, tk := range tasks {
		byTitle[tk.Title] = tk
	}
	vm2, ip2 := byTitle["Create VM"], byTitle["Create IP"]
	if vm2.Key != newKey+"-3" || vm2.EnvironmentName == nil || *vm2.EnvironmentName != "Prod" {
		t.Fatalf("restored VM = key %s env %v", vm2.Key, vm2.EnvironmentName)
	}
	if len(vm2.BlockedBy) != 1 || vm2.BlockedBy[0] != ip2.ID || ip2.Status != "done" {
		t.Fatalf("restored dependency/status wrong: %+v / %+v", vm2.BlockedBy, ip2.Status)
	}
	if byTitle["Project"].ProjectKind == nil || *byTitle["Project"].ProjectKind != "long" {
		t.Fatal("project kind lost")
	}

	// The runbook comes back: notes, the tick (and who), and the step's link
	// to the restored daily task, not the original.
	rb, err := st.Runbook(ctx, byTitle["Deploy"].ID)
	if err != nil || len(rb) != 1 || rb[0].Name != "Preparation" || rb[0].Notes != notes || len(rb[0].Steps) != 2 {
		t.Fatalf("restored runbook = %+v, %v", rb, err)
	}
	for _, s := range rb[0].Steps {
		switch s.Title {
		case "Back up the DB":
			if !s.Done || s.DoneBy == nil || *s.DoneBy != alice.ID || s.Notes != notes || s.DurationMinutes == nil || *s.DurationMinutes != 45 {
				t.Errorf("restored ticked step = %+v", s)
			}
		case "Prepare rollback":
			if s.Task == nil || s.Task.ID != byTitle["Prepare rollback"].ID || s.Task.WorkspaceKey != newKey {
				t.Errorf("restored linked step = %+v", s.Task)
			}
		default:
			t.Errorf("unexpected step %q", s.Title)
		}
	}
	if tpls, _ := st.RunbookTemplates(ctx, res.Workspace.ID); len(tpls) != 1 || tpls[0].Name != "Deploy" || !tpls[0].Sections[0].Steps[0].AsTask || tpls[0].Sections[0].Steps[0].Title != "Prepare rollback" {
		t.Errorf("restored templates = %+v", tpls)
	}

	// Older backups without runbooks still import.
	old := doc
	old.RunbookSections, old.RunbookSteps, old.RunbookTemplates = nil, nil, nil
	if r, err := st.ImportWorkspaceData(ctx, old, ImportOptions{Key: newKey + "O", DryRun: true}); err != nil || r.RunbookSteps != 0 {
		t.Errorf("backup without runbooks: %+v, %v", r, err)
	}
	// A step pointing at a task outside the backup is rejected.
	broken := doc
	broken.RunbookSteps = append([]ExportRunbookStep{}, doc.RunbookSteps...)
	missing := "no-such-task"
	broken.RunbookSteps[0].LinkedTask = &missing
	if _, err := st.ImportWorkspaceData(ctx, broken, ImportOptions{Key: newKey + "B", DryRun: true}); err == nil {
		t.Error("runbook step linked to a missing task accepted")
	}

	// Unknown people are dropped, not invented.
	doc.Users[0].Username = "nobody-" + suffix
	res3, err := st.ImportWorkspaceData(ctx, doc, ImportOptions{Key: newKey, DryRun: true})
	if err != nil || res3.Assignments != 0 || len(res3.UnknownUsers) != 1 {
		t.Fatalf("unknown users result = %+v, %v", res3, err)
	}

	// A loop in dependencies is rejected.
	doc.Dependencies = append(doc.Dependencies, ExportDependency{Task: ip.ID, DependsOn: vm.ID})
	if _, err := st.ImportWorkspaceData(ctx, doc, ImportOptions{Key: newKey + "X", DryRun: true}); err == nil {
		t.Fatal("dependency loop should be rejected")
	}
}
