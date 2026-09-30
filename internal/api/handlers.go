package api

import (
	"encoding/json"
	"net/http"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/FadhlanHawali/open-planner/internal/auth"
	"github.com/FadhlanHawali/open-planner/internal/store"
)

// --- workspaces ---

func (a *API) listWorkspaces(w http.ResponseWriter, r *http.Request) {
	p, err := a.store.ListWorkspaces(r.Context())
	respond(w, p, err)
}

func (a *API) getWorkspace(w http.ResponseWriter, r *http.Request) {
	p, err := a.store.GetWorkspace(r.Context(), chi.URLParam(r, "id"))
	respond(w, p, err)
}

func (a *API) createWorkspace(w http.ResponseWriter, r *http.Request) {
	var in store.WorkspaceInput
	if err := decode(r, &in); err != nil {
		respond(w, nil, err)
		return
	}
	p, err := a.store.CreateWorkspace(r.Context(), in, auth.UserFrom(r.Context()).ID)
	respondStatus(w, http.StatusCreated, p, err)
}

func (a *API) updateWorkspace(w http.ResponseWriter, r *http.Request) {
	var in store.WorkspaceInput
	if err := decode(r, &in); err != nil {
		respond(w, nil, err)
		return
	}
	p, err := a.store.UpdateWorkspace(r.Context(), chi.URLParam(r, "id"), in)
	respond(w, p, err)
}

func (a *API) deleteWorkspace(w http.ResponseWriter, r *http.Request) {
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
	tasks, err := a.store.ListTasks(r.Context(), store.TaskFilter{
		WorkspaceID: q.Get("workspace_id"),
		AssigneeID:  q.Get("assignee_id"),
		ParentID:    q.Get("parent_id"),
		TopLevel:    q.Get("top_level") == "true",
		Types:       splitList(q.Get("type")),
		From:        from,
		To:          to,
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
	err := a.store.AddDependency(r.Context(), chi.URLParam(r, "id"), in.DependsOnID)
	respondStatus(w, http.StatusCreated, map[string]bool{"added": true}, err)
}

func (a *API) removeDependency(w http.ResponseWriter, r *http.Request) {
	err := a.store.RemoveDependency(r.Context(), chi.URLParam(r, "id"), chi.URLParam(r, "dependsOnID"))
	respond(w, map[string]bool{"removed": true}, err)
}

func (a *API) createTask(w http.ResponseWriter, r *http.Request) {
	var in store.TaskInput
	if err := decode(r, &in); err != nil {
		respond(w, nil, err)
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
	t, err := a.store.UpdateTask(r.Context(), chi.URLParam(r, "id"), patch)
	respond(w, t, err)
}

func (a *API) deleteTask(w http.ResponseWriter, r *http.Request) {
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
	rows, err := a.store.WorkloadReport(r.Context(), from, to, r.URL.Query().Get("workspace_id"))
	respond(w, rows, err)
}

func (a *API) workloadTasks(w http.ResponseWriter, r *http.Request) {
	from, to, err := reportRange(r)
	if err != nil {
		respond(w, nil, err)
		return
	}
	tasks, err := a.store.WorkloadTasks(r.Context(), chi.URLParam(r, "userID"), from, to, r.URL.Query().Get("workspace_id"))
	respond(w, tasks, err)
}
