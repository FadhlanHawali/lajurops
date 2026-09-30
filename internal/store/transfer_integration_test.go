package store

import (
	"context"
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
	mk(TaskInput{Title: "Deploy", Type: "hourly", ParentID: &vm.ID, AssigneeIDs: []string{alice.ID}})
	if err := st.AddDependency(ctx, vm.ID, ip.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := st.CreateComment(ctx, vm.ID, alice.ID, "**note**"); err != nil {
		t.Fatal(err)
	}

	doc, err := st.ExportWorkspaceData(ctx, ws.ID, "alice")
	if err != nil {
		t.Fatal(err)
	}
	if len(doc.Tasks) != 4 || len(doc.Environments) != 2 || len(doc.Dependencies) != 1 || len(doc.Comments) != 1 || len(doc.Users) != 1 {
		t.Fatalf("export counts: tasks %d envs %d deps %d comments %d users %d", len(doc.Tasks), len(doc.Environments), len(doc.Dependencies), len(doc.Comments), len(doc.Users))
	}

	// Same key is reported as taken on a dry run and refused on import.
	dry, err := st.ImportWorkspaceData(ctx, doc, ImportOptions{DryRun: true})
	if err != nil || !dry.KeyTaken || dry.Tasks != 4 {
		t.Fatalf("dry run = %+v, %v", dry, err)
	}
	if _, err := st.ImportWorkspaceData(ctx, doc, ImportOptions{}); err == nil {
		t.Fatal("import with a taken key should fail")
	}

	res, err := st.ImportWorkspaceData(ctx, doc, ImportOptions{Key: newKey, Name: "Restored"})
	if err != nil {
		t.Fatal(err)
	}
	if res.Tasks != 4 || res.Environments != 2 || res.Dependencies != 1 || res.Comments != 1 || res.Assignments != 2 || len(res.UnknownUsers) != 0 {
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
