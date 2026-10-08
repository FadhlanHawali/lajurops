package api

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/FadhlanHawali/lajurops/internal/auth"
	"github.com/FadhlanHawali/lajurops/internal/config"
	"github.com/FadhlanHawali/lajurops/internal/store"
)

// Runs against a real, migrated database (see internal/store's integration tests):
//
//	PLANNER_TEST_DATABASE_URL=postgres://... go test ./internal/api
func TestWorkspaceAccess(t *testing.T) {
	url := os.Getenv("PLANNER_TEST_DATABASE_URL")
	if url == "" {
		t.Skip("PLANNER_TEST_DATABASE_URL not set")
	}
	ctx := context.Background()
	pool, err := pgxpool.New(ctx, url)
	if err != nil {
		t.Fatal(err)
	}
	defer pool.Close()
	st := store.New(pool)
	a := &API{cfg: config.Config{DefaultWorkspaceRole: "viewer"}, store: st}

	suffix := fmt.Sprint(time.Now().UnixNano() % 1_000_000)
	user := func(name string, admin bool) auth.Principal {
		sub := "itest-" + name + "-" + suffix
		u, err := st.UpsertUser(ctx, sub, name+suffix, "", name)
		if err != nil {
			t.Fatal(err)
		}
		t.Cleanup(func() { pool.Exec(ctx, `DELETE FROM users WHERE id = $1`, u.ID) })
		return auth.Principal{User: u, Sub: sub, IsAdmin: admin}
	}
	admin, ed, vi := user("admin", true), user("ed", false), user("vi", false)

	// The test router injects the principal instead of verifying a token.
	var as auth.Principal
	r := chi.NewRouter()
	r.Use(func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
			next.ServeHTTP(w, req.WithContext(auth.WithPrincipal(req.Context(), as)))
		})
	})
	a.routes(r)
	call := func(p auth.Principal, method, path string, body any) (int, map[string]any, []any) {
		t.Helper()
		as = p
		var buf bytes.Buffer
		if body != nil {
			json.NewEncoder(&buf).Encode(body)
		}
		rec := httptest.NewRecorder()
		r.ServeHTTP(rec, httptest.NewRequest(method, path, &buf))
		var obj map[string]any
		var list []any
		json.Unmarshal(rec.Body.Bytes(), &obj)
		json.Unmarshal(rec.Body.Bytes(), &list)
		return rec.Code, obj, list
	}
	expect := func(what string, got, want int) {
		t.Helper()
		if got != want {
			t.Errorf("%s: status %d, want %d", what, got, want)
		}
	}

	// The admin creates two workspaces; ed edits W1 and can't see W2; vi has the default (viewer).
	mk := func(p auth.Principal, key string) string {
		code, w, _ := call(p, "POST", "/workspaces", map[string]string{"key": key, "name": key})
		expect("create "+key, code, 201)
		id, _ := w["id"].(string)
		t.Cleanup(func() { st.DeleteWorkspace(ctx, id) })
		return id
	}
	w1, w2 := mk(admin, "IA"+suffix[:4]), mk(admin, "IB"+suffix[:4])
	if err := st.SetUserAccess(ctx, ed.ID, map[string]string{w1: "editor", w2: "none"}); err != nil {
		t.Fatal(err)
	}

	// Admin: full access.
	code, task, _ := call(admin, "POST", "/tasks", map[string]any{"workspace_id": w2, "title": "secret", "type": "daily"})
	expect("admin creates in W2", code, 201)
	secret, _ := task["id"].(string)

	// Editor: CRUD in W1; W2 doesn't exist for them.
	code, task, _ = call(ed, "POST", "/tasks", map[string]any{"workspace_id": w1, "title": "work", "type": "daily"})
	expect("editor creates in W1", code, 201)
	work, _ := task["id"].(string)
	code, _, _ = call(ed, "PATCH", "/tasks/"+work, map[string]any{"status": "done"})
	expect("editor updates in W1", code, 200)
	code, _, _ = call(ed, "POST", "/tasks/"+work+"/comments", map[string]string{"body": "hi"})
	expect("editor comments in W1", code, 201)
	code, _, _ = call(ed, "POST", "/tasks", map[string]any{"workspace_id": w2, "title": "x", "type": "daily"})
	expect("editor creates in W2", code, 404)
	code, _, _ = call(ed, "GET", "/tasks/"+secret, nil)
	expect("editor reads a W2 task", code, 404)
	code, _, _ = call(ed, "GET", "/workspaces/"+w2, nil)
	expect("editor opens W2", code, 404)
	_, _, list := call(ed, "GET", "/workspaces", nil)
	for _, w := range list {
		if w.(map[string]any)["id"] == w2 {
			t.Error("W2 is listed for the editor")
		}
	}
	_, _, tasks := call(ed, "GET", "/tasks", nil)
	for _, x := range tasks {
		if x.(map[string]any)["id"] == secret {
			t.Error("a W2 task is listed for the editor")
		}
	}

	// Viewer (default role): read only, everywhere.
	code, _, _ = call(vi, "GET", "/tasks/"+work, nil)
	expect("viewer reads", code, 200)
	code, _, _ = call(vi, "GET", "/tasks/"+work+"/comments", nil)
	expect("viewer reads comments", code, 200)
	code, _, _ = call(vi, "GET", "/workspaces/"+w1+"/export", nil)
	expect("viewer exports", code, 200)
	code, _, _ = call(vi, "PATCH", "/tasks/"+work, map[string]any{"title": "nope"})
	expect("viewer updates", code, 403)
	code, _, _ = call(vi, "POST", "/tasks", map[string]any{"workspace_id": w1, "title": "nope", "type": "daily"})
	expect("viewer creates", code, 403)
	code, _, _ = call(vi, "DELETE", "/tasks/"+work, nil)
	expect("viewer deletes", code, 403)
	code, _, _ = call(vi, "POST", "/tasks/"+work+"/comments", map[string]string{"body": "nope"})
	expect("viewer comments", code, 403)
	code, _, _ = call(vi, "GET", "/tasks/"+work+"/runbook", nil)
	expect("viewer reads the runbook", code, 200)
	code, _, _ = call(ed, "POST", "/tasks/"+work+"/runbook/sections", map[string]string{"name": "Prep"})
	expect("runbook on a daily task", code, 400)
	_, task, _ = call(ed, "POST", "/tasks", map[string]any{"workspace_id": w1, "title": "release", "type": "hourly"})
	release, _ := task["id"].(string)
	code, _, _ = call(vi, "POST", "/tasks/"+release+"/runbook/sections", map[string]string{"name": "Prep"})
	expect("viewer adds a runbook section", code, 403)
	code, sec, _ := call(ed, "POST", "/tasks/"+release+"/runbook/sections", map[string]string{"name": "Prep"})
	expect("editor adds a runbook section", code, 201)
	secID, _ := sec["id"].(string)
	code, _, _ = call(vi, "POST", "/runbook/sections/"+secID+"/steps", map[string]any{"title": "Prepare", "task": map[string]string{}})
	expect("viewer adds a step task", code, 403)
	code, step, _ := call(ed, "POST", "/runbook/sections/"+secID+"/steps", map[string]any{"title": "Prepare", "task": map[string]string{"day": "2026-10-08", "tz": "UTC"}})
	expect("editor adds a step task", code, 201)
	stepID, _ := step["id"].(string)
	code, _, _ = call(vi, "DELETE", "/runbook/steps/"+stepID+"/task", nil)
	expect("viewer unlinks a step task", code, 403)
	code, _, _ = call(ed, "DELETE", "/runbook/steps/"+stepID+"/task", nil)
	expect("editor unlinks a step task", code, 200)
	code, _, _ = call(vi, "PUT", "/workspaces/"+w1+"/categories", []any{})
	expect("viewer edits categories", code, 403)
	code, _, _ = call(vi, "DELETE", "/workspaces/"+w1, nil)
	expect("viewer deletes the workspace", code, 403)
	code, _, _ = call(vi, "POST", "/workspaces", map[string]string{"key": "IC" + suffix[:4], "name": "x"})
	expect("viewer creates a workspace", code, 403)

	// An editor (anywhere) can create a workspace and becomes its editor.
	w3 := mk(ed, "IC"+suffix[:4])
	code, _, _ = call(ed, "POST", "/tasks", map[string]any{"workspace_id": w3, "title": "mine", "type": "daily"})
	expect("editor creates in their new workspace", code, 201)

	// /me reports roles: W2 is hidden from ed.
	_, me, _ := call(ed, "GET", "/me", nil)
	roles, _ := me["workspace_roles"].(map[string]any)
	if roles[w1] != "editor" || roles[w3] != "editor" || roles[w2] != nil || me["can_create_workspace"] != true {
		t.Errorf("ed /me = %v", me)
	}
	_, me, _ = call(vi, "GET", "/me", nil)
	if me["can_create_workspace"] != false {
		t.Errorf("vi can create workspaces: %v", me)
	}
	_, me, _ = call(admin, "GET", "/me", nil)
	if me["workspace_roles"] != nil {
		t.Errorf("admin roles should be null: %v", me["workspace_roles"])
	}

	// Workload is scoped to what the caller can see.
	q := "?from=2000-01-01T00:00:00Z&to=2100-01-01T00:00:00Z"
	code, _, _ = call(ed, "GET", "/reports/workload"+q+"&workspace_id="+w2, nil)
	expect("editor reports on W2", code, 404)
	code, _, _ = call(vi, "GET", "/reports/workload"+q, nil)
	expect("viewer reports", code, 200)
}
