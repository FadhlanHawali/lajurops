package api

import (
	"encoding/json"
	"net/http"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/FadhlanHawali/lajurops/internal/auth"
	"github.com/FadhlanHawali/lajurops/internal/store"
)

// --- workspaces ---

// workspaceView adds the caller's role ("admin", "editor" or "viewer").
type workspaceView struct {
	store.Workspace
	MyRole string `json:"my_role"`
}

func roleName(roles map[string]string, ws string) string {
	if roles == nil {
		return "admin"
	}
	return roles[ws]
}

func (a *API) listWorkspaces(w http.ResponseWriter, r *http.Request) {
	list, err := a.store.ListWorkspaces(r.Context())
	if err != nil {
		respond(w, nil, err)
		return
	}
	roles, err := a.roles(r)
	if err != nil {
		respond(w, nil, err)
		return
	}
	out := []workspaceView{}
	for _, p := range list {
		if role := roleName(roles, p.ID); roles == nil || levelOf(role) >= levelViewer {
			out = append(out, workspaceView{p, role})
		}
	}
	respond(w, out, nil)
}

func (a *API) getWorkspace(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	if !a.require(w, r, id, levelViewer) {
		return
	}
	p, err := a.store.GetWorkspace(r.Context(), id)
	if err != nil {
		respond(w, nil, err)
		return
	}
	roles, err := a.roles(r)
	respond(w, workspaceView{p, roleName(roles, id)}, err)
}

func (a *API) createWorkspace(w http.ResponseWriter, r *http.Request) {
	var in store.WorkspaceInput
	if err := decode(r, &in); err != nil {
		respond(w, nil, err)
		return
	}
	if !a.requireCreate(w, r) {
		return
	}
	p, err := a.store.CreateWorkspace(r.Context(), in, auth.UserFrom(r.Context()).ID)
	if err == nil {
		err = a.joinAsEditor(r, p.ID)
	}
	respondStatus(w, http.StatusCreated, p, err)
}

// requireCreate checks the caller may create (or import) workspaces.
func (a *API) requireCreate(w http.ResponseWriter, r *http.Request) bool {
	ok, err := a.canCreateWorkspaces(r)
	if err != nil {
		respond(w, nil, err)
		return false
	}
	if !ok {
		writeJSON(w, http.StatusForbidden, map[string]string{"error": "creating workspaces needs editor access to at least one workspace"})
	}
	return ok
}

// joinAsEditor makes a non-admin creator an editor of their new workspace.
func (a *API) joinAsEditor(r *http.Request, workspaceID string) error {
	p := auth.From(r.Context())
	if p.IsAdmin {
		return nil
	}
	return a.store.SetMember(r.Context(), workspaceID, p.ID, store.RoleEditor)
}

func (a *API) updateWorkspace(w http.ResponseWriter, r *http.Request) {
	if !a.require(w, r, chi.URLParam(r, "id"), levelEditor) {
		return
	}
	var in store.WorkspaceInput
	if err := decode(r, &in); err != nil {
		respond(w, nil, err)
		return
	}
	p, err := a.store.UpdateWorkspace(r.Context(), chi.URLParam(r, "id"), in)
	respond(w, p, err)
}

func (a *API) deleteWorkspace(w http.ResponseWriter, r *http.Request) {
	if !a.require(w, r, chi.URLParam(r, "id"), levelEditor) {
		return
	}
	err := a.store.DeleteWorkspace(r.Context(), chi.URLParam(r, "id"))
	respondStatus(w, http.StatusOK, map[string]bool{"deleted": true}, err)
}

// --- tasks ---

func (a *API) listTasks(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	from, to, err := parseRange(r)
	if err != nil {
		respond(w, nil, err)
		return
	}
	if ws := q.Get("workspace_id"); ws != "" && !a.require(w, r, ws, levelViewer) {
		return
	}
	if parent := q.Get("parent_id"); parent != "" && !a.requireTask(w, r, parent, levelViewer) {
		return
	}
	visible, err := a.visible(r)
	if err != nil {
		respond(w, nil, err)
		return
	}
	tasks, err := a.store.ListTasks(r.Context(), store.TaskFilter{
		WorkspaceIDs: visible,
		WorkspaceID:  q.Get("workspace_id"),
		AssigneeID:   q.Get("assignee_id"),
		ParentID:     q.Get("parent_id"),
		TopLevel:     q.Get("top_level") == "true",
		Types:        splitList(q.Get("type")),
		// ?undated=open|all (with from/to) and ?ancestors=true: see TaskFilter.
		Undated:       q.Get("undated"),
		WithAncestors: q.Get("ancestors") == "true",
		From:          from,
		To:            to,
	})
	respond(w, tasks, err)
}

type taskDetail struct {
	store.Task
	Subtasks []store.Task `json:"subtasks"`
	// Ancestors lists the parent chain, outermost first.
	Ancestors []store.Task `json:"ancestors"`
	// WaitingFor are the tasks this one depends on; Blocking wait for it.
	WaitingFor []store.Task `json:"waiting_for"`
	Blocking   []store.Task `json:"blocking"`
}

func splitList(s string) []string {
	if s == "" {
		return nil
	}
	return strings.Split(s, ",")
}

func (a *API) getTask(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	if !a.requireTask(w, r, chi.URLParam(r, "id"), levelViewer) {
		return
	}
	t, err := a.store.GetTask(ctx, chi.URLParam(r, "id"))
	if err != nil {
		respond(w, nil, err)
		return
	}
	d := taskDetail{Task: t, Ancestors: []store.Task{}}
	// The hierarchy is at most three levels deep, so this loop is short.
	for parent := t.ParentID; parent != nil; {
		p, err := a.store.GetTask(ctx, *parent)
		if err != nil {
			respond(w, nil, err)
			return
		}
		d.Ancestors = append([]store.Task{p}, d.Ancestors...)
		parent = p.ParentID
	}
	if d.Subtasks, err = a.store.ListTasks(ctx, store.TaskFilter{ParentID: t.ID}); err != nil {
		respond(w, nil, err)
		return
	}
	if d.WaitingFor, err = a.store.WaitingFor(ctx, t.ID); err != nil {
		respond(w, nil, err)
		return
	}
	d.Blocking, err = a.store.Blocking(ctx, t.ID)
	respond(w, d, err)
}

func (a *API) addDependency(w http.ResponseWriter, r *http.Request) {
	var in struct {
		DependsOnID string `json:"depends_on_id"`
	}
	if err := decode(r, &in); err != nil {
		respond(w, nil, err)
		return
	}
	// The store requires both tasks to be in the same workspace.
	if !a.requireTask(w, r, chi.URLParam(r, "id"), levelEditor) {
		return
	}
	err := a.store.AddDependency(r.Context(), chi.URLParam(r, "id"), in.DependsOnID)
	respondStatus(w, http.StatusCreated, map[string]bool{"added": true}, err)
}

func (a *API) removeDependency(w http.ResponseWriter, r *http.Request) {
	if !a.requireTask(w, r, chi.URLParam(r, "id"), levelEditor) {
		return
	}
	err := a.store.RemoveDependency(r.Context(), chi.URLParam(r, "id"), chi.URLParam(r, "dependsOnID"))
	respond(w, map[string]bool{"removed": true}, err)
}

func (a *API) createTask(w http.ResponseWriter, r *http.Request) {
	var in store.TaskInput
	if err := decode(r, &in); err != nil {
		respond(w, nil, err)
		return
	}
	// A subtask lives in its parent's workspace (the store enforces this).
	if in.ParentID != nil && *in.ParentID != "" {
		if !a.requireTask(w, r, *in.ParentID, levelEditor) {
			return
		}
	} else if in.WorkspaceID != "" && !a.require(w, r, in.WorkspaceID, levelEditor) {
		return
	}
	t, err := a.store.CreateTask(r.Context(), in, auth.UserFrom(r.Context()).ID)
	respondStatus(w, http.StatusCreated, t, err)
}

func (a *API) updateTask(w http.ResponseWriter, r *http.Request) {
	var patch map[string]json.RawMessage
	if err := decode(r, &patch); err != nil {
		respond(w, nil, err)
		return
	}
	// Tasks can't change workspace, and a new parent must be in the same one.
	if !a.requireTask(w, r, chi.URLParam(r, "id"), levelEditor) {
		return
	}
	t, err := a.store.UpdateTask(r.Context(), chi.URLParam(r, "id"), patch)
	respond(w, t, err)
}

func (a *API) deleteTask(w http.ResponseWriter, r *http.Request) {
	if !a.requireTask(w, r, chi.URLParam(r, "id"), levelEditor) {
		return
	}
	err := a.store.DeleteTask(r.Context(), chi.URLParam(r, "id"))
	respond(w, map[string]bool{"deleted": true}, err)
}

// --- reports ---

func reportRange(r *http.Request) (time.Time, time.Time, error) {
	from, to, err := parseRange(r)
	if err != nil {
		return time.Time{}, time.Time{}, err
	}
	if from == nil || to == nil || !to.After(*from) {
		return time.Time{}, time.Time{}, store.InvalidError{Msg: "from and to are required, with to after from"}
	}
	return *from, *to, nil
}

func (a *API) workloadReport(w http.ResponseWriter, r *http.Request) {
	from, to, err := reportRange(r)
	if err != nil {
		respond(w, nil, err)
		return
	}
	scope, ok := a.reportScope(w, r)
	if !ok {
		return
	}
	rows, err := a.store.WorkloadReport(r.Context(), from, to, scope)
	respond(w, rows, err)
}

func (a *API) workloadTasks(w http.ResponseWriter, r *http.Request) {
	from, to, err := reportRange(r)
	if err != nil {
		respond(w, nil, err)
		return
	}
	scope, ok := a.reportScope(w, r)
	if !ok {
		return
	}
	tasks, err := a.store.WorkloadTasks(r.Context(), chi.URLParam(r, "userID"), from, to, scope)
	respond(w, tasks, err)
}

// reportScope is ?workspace_id (when the caller can see it), or every
// workspace the caller can see.
func (a *API) reportScope(w http.ResponseWriter, r *http.Request) (store.Scope, bool) {
	if ws := r.URL.Query().Get("workspace_id"); ws != "" {
		return store.Scope{ws}, a.require(w, r, ws, levelViewer)
	}
	visible, err := a.visible(r)
	if err != nil {
		respond(w, nil, err)
		return nil, false
	}
	return store.Scope(visible), true
}
