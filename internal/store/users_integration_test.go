package store

import (
	"context"
	"fmt"
	"os"
	"slices"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

// Integration tests run against a real, migrated database:
//
//	PLANNER_TEST_DATABASE_URL=postgres://... go test ./internal/store
//
// They create uniquely named data and remove it afterwards.
func testStore(t *testing.T) (*Store, *pgxpool.Pool) {
	url := os.Getenv("PLANNER_TEST_DATABASE_URL")
	if url == "" {
		t.Skip("PLANNER_TEST_DATABASE_URL not set")
	}
	pool, err := pgxpool.New(context.Background(), url)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(pool.Close)
	return New(pool), pool
}

func TestSyncAndPurgeUser(t *testing.T) {
	st, pool := testStore(t)
	ctx := context.Background()
	suffix := fmt.Sprint(time.Now().UnixNano())
	sub := func(n string) string { return "itest-" + n + "-" + suffix }

	// ghost will be missing from Keycloak; bob stays.
	ghost, err := st.UpsertUser(ctx, sub("ghost"), "ghost-"+suffix, "", "Ghost")
	if err != nil {
		t.Fatal(err)
	}
	bob, err := st.UpsertUser(ctx, sub("bob"), "bob-"+suffix, "", "Bob")
	if err != nil {
		t.Fatal(err)
	}
	ws, err := st.CreateWorkspace(ctx, WorkspaceInput{Key: "IT" + suffix[len(suffix)-6:], Name: "itest"}, "")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		st.DeleteWorkspace(ctx, ws.ID)
		pool.Exec(ctx, `DELETE FROM users WHERE keycloak_sub LIKE $1`, "itest-%-"+suffix)
	})

	mk := func(in TaskInput) Task {
		t.Helper()
		in.WorkspaceID = ws.ID
		task, err := st.CreateTask(ctx, in, "")
		if err != nil {
			t.Fatalf("create %q: %v", in.Title, err)
		}
		return task
	}
	clean := mk(TaskInput{Title: "ghost-only project", Type: "project", AssigneeIDs: []string{ghost.ID}})
	cleanChild := mk(TaskInput{Title: "ghost daily", Type: "daily", ParentID: &clean.ID, AssigneeIDs: []string{ghost.ID}})
	mixed := mk(TaskInput{Title: "ghost project with bob inside", Type: "project", AssigneeIDs: []string{ghost.ID}})
	bobsWork := mk(TaskInput{Title: "bob's work", Type: "daily", ParentID: &mixed.ID, AssigneeIDs: []string{bob.ID}})
	shared := mk(TaskInput{Title: "shared", Type: "hourly", AssigneeIDs: []string{ghost.ID, bob.ID}})
	if _, err := st.CreateComment(ctx, shared.ID, ghost.ID, "hi"); err != nil {
		t.Fatal(err)
	}

	// Sync with a Keycloak that only knows bob (plus everyone already in
	// the database, so this test doesn't mark real users deleted).
	var existing []KeycloakUser
	// Pass everyone else through unchanged so real users keep their state.
	rows, _ := pool.Query(ctx, `SELECT keycloak_sub, username, email, display_name, active FROM users WHERE deleted_at IS NULL AND keycloak_sub <> $1`, sub("ghost"))
	for rows.Next() {
		var k KeycloakUser
		rows.Scan(&k.Sub, &k.Username, &k.Email, &k.DisplayName, &k.Enabled)
		existing = append(existing, k)
	}
	rows.Close()
	res, err := st.SyncAll(ctx, existing)
	if err != nil {
		t.Fatal(err)
	}
	if !slices.Contains(res.MarkedDeleted, "ghost-"+suffix) || slices.Contains(res.MarkedDeleted, "bob-"+suffix) {
		t.Fatalf("marked deleted = %v", res.MarkedDeleted)
	}

	removed, err := st.GetRemovedUser(ctx, ghost.ID)
	if err != nil {
		t.Fatal(err)
	}
	// Deletable: the clean project and its daily. Not: the project holding
	// bob's work, and the shared task.
	if removed.SoleTasks != 2 || removed.SharedTasks != 2 || removed.Comments != 1 {
		t.Fatalf("impact = sole %d, shared %d, comments %d", removed.SoleTasks, removed.SharedTasks, removed.Comments)
	}

	if _, err := st.PurgeUser(ctx, bob.ID, true); err == nil {
		t.Fatal("purging a user that still exists in Keycloak should fail")
	}

	pr, err := st.PurgeUser(ctx, ghost.ID, true)
	if err != nil {
		t.Fatal(err)
	}
	if pr.DeletedTasks != 2 {
		t.Fatalf("deleted %d tasks, want 2", pr.DeletedTasks)
	}
	for _, id := range []string{clean.ID, cleanChild.ID} {
		if _, err := st.GetTask(ctx, id); err != ErrNotFound {
			t.Fatalf("task %s should be deleted, got %v", id, err)
		}
	}
	for _, id := range []string{mixed.ID, bobsWork.ID, shared.ID} {
		task, err := st.GetTask(ctx, id)
		if err != nil {
			t.Fatalf("task %s should remain: %v", id, err)
		}
		if slices.Contains(task.AssigneeIDs, ghost.ID) {
			t.Fatalf("task %s still assigned to ghost", id)
		}
	}
	if s, _ := st.GetTask(ctx, shared.ID); !slices.Equal(s.AssigneeIDs, []string{bob.ID}) {
		t.Fatalf("shared task owners = %v, want only bob", s.AssigneeIDs)
	}
	comments, _ := st.ListComments(ctx, shared.ID)
	if len(comments) != 1 || comments[0].AuthorID != nil {
		t.Fatalf("comment should remain with no author, got %+v", comments)
	}
}
