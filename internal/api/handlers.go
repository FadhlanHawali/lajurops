package api

import (
	"encoding/json"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/FadhlanHawali/open-planner/internal/auth"
	"github.com/FadhlanHawali/open-planner/internal/store"
)

// --- projects ---

func (a *API) listProjects(w http.ResponseWriter, r *http.Request) {
	p, err := a.store.ListProjects(r.Context())
	respond(w, p, err)
}

func (a *API) getProject(w http.ResponseWriter, r *http.Request) {
	p, err := a.store.GetProject(r.Context(), chi.URLParam(r, "id"))
	respond(w, p, err)
}

func (a *API) createProject(w http.ResponseWriter, r *http.Request) {
	var in store.ProjectInput
	if err := decode(r, &in); err != nil {
		respond(w, nil, err)
		return
	}
	p, err := a.store.CreateProject(r.Context(), in, auth.UserFrom(r.Context()).ID)
	respondStatus(w, http.StatusCreated, p, err)
}

func (a *API) updateProject(w http.ResponseWriter, r *http.Request) {
	var in store.ProjectInput
	if err := decode(r, &in); err != nil {
		respond(w, nil, err)
		return
	}
	p, err := a.store.UpdateProject(r.Context(), chi.URLParam(r, "id"), in)
	respond(w, p, err)
}

func (a *API) deleteProject(w http.ResponseWriter, r *http.Request) {
	err := a.store.DeleteProject(r.Context(), chi.URLParam(r, "id"))
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
		ProjectID:  q.Get("project_id"),
		AssigneeID: q.Get("assignee_id"),
		ParentID:   q.Get("parent_id"),
		TopLevel:   q.Get("top_level") == "true",
		Type:       q.Get("type"),
		From:       from,
		To:         to,
	})
	respond(w, tasks, err)
}

type taskDetail struct {
	store.Task
	Subtasks []store.Task `json:"subtasks"`
	Parent   *store.Task  `json:"parent"`
}

func (a *API) getTask(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	t, err := a.store.GetTask(ctx, chi.URLParam(r, "id"))
	if err != nil {
		respond(w, nil, err)
		return
	}
	d := taskDetail{Task: t, Subtasks: []store.Task{}}
	if t.ParentID != nil {
		p, err := a.store.GetTask(ctx, *t.ParentID)
		if err != nil {
			respond(w, nil, err)
			return
		}
		d.Parent = &p
	} else if d.Subtasks, err = a.store.ListTasks(ctx, store.TaskFilter{ParentID: t.ID}); err != nil {
		respond(w, nil, err)
		return
	}
	respond(w, d, nil)
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
	rows, err := a.store.WorkloadReport(r.Context(), from, to, r.URL.Query().Get("project_id"))
	respond(w, rows, err)
}

func (a *API) workloadTasks(w http.ResponseWriter, r *http.Request) {
	from, to, err := reportRange(r)
	if err != nil {
		respond(w, nil, err)
		return
	}
	tasks, err := a.store.WorkloadTasks(r.Context(), chi.URLParam(r, "userID"), from, to, r.URL.Query().Get("project_id"))
	respond(w, tasks, err)
}
