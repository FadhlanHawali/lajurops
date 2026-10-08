package api

import (
	"net/http"

	"github.com/go-chi/chi/v5"

	"github.com/FadhlanHawali/lajurops/internal/auth"
	"github.com/FadhlanHawali/lajurops/internal/store"
)

// Runbooks: viewers of a task's workspace can read them, editors change them.

func (a *API) getRunbook(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	if !a.requireTask(w, r, id, levelViewer) {
		return
	}
	secs, err := a.store.Runbook(r.Context(), id)
	respond(w, secs, err)
}

func (a *API) addRunbookSection(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Name string `json:"name"`
	}
	if err := decode(r, &in); err != nil {
		respond(w, nil, err)
		return
	}
	id := chi.URLParam(r, "id")
	if !a.requireTask(w, r, id, levelEditor) {
		return
	}
	sec, err := a.store.AddRunbookSection(r.Context(), id, in.Name)
	respondStatus(w, http.StatusCreated, sec, err)
}

func (a *API) orderRunbookSections(w http.ResponseWriter, r *http.Request) {
	var in struct {
		SectionIDs []string `json:"section_ids"`
	}
	if err := decode(r, &in); err != nil {
		respond(w, nil, err)
		return
	}
	id := chi.URLParam(r, "id")
	if !a.requireTask(w, r, id, levelEditor) {
		return
	}
	err := a.store.OrderRunbookSections(r.Context(), id, in.SectionIDs)
	respond(w, map[string]bool{"ok": true}, err)
}

// requireSection checks editor access to the task a section belongs to.
func (a *API) requireSection(w http.ResponseWriter, r *http.Request, sectionID string) bool {
	task, err := a.store.RunbookSectionTask(r.Context(), sectionID)
	if err != nil {
		respond(w, nil, err)
		return false
	}
	return a.requireTask(w, r, task, levelEditor)
}

// updateRunbookSection changes a section's name and/or notes.
func (a *API) updateRunbookSection(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Name  *string `json:"name"`
		Notes *string `json:"notes"`
	}
	if err := decode(r, &in); err != nil {
		respond(w, nil, err)
		return
	}
	id := chi.URLParam(r, "id")
	if !a.requireSection(w, r, id) {
		return
	}
	err := a.store.UpdateRunbookSection(r.Context(), id, in.Name, in.Notes)
	respond(w, map[string]bool{"ok": true}, err)
}

func (a *API) deleteRunbookSection(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	if !a.requireSection(w, r, id) {
		return
	}
	err := a.store.DeleteRunbookSection(r.Context(), id)
	respond(w, map[string]bool{"deleted": true}, err)
}

// addRunbookStep adds a checklist step, or, with "task": {day, tz}, a step
// tracked as its own daily task.
func (a *API) addRunbookStep(w http.ResponseWriter, r *http.Request) {
	var in struct {
		store.RunbookStepInput
		Task *store.StepTaskInput `json:"task"`
	}
	if err := decode(r, &in); err != nil {
		respond(w, nil, err)
		return
	}
	id := chi.URLParam(r, "id")
	if !a.requireSection(w, r, id) {
		return
	}
	st, err := a.store.AddRunbookStep(r.Context(), id, in.RunbookStepInput)
	if err == nil && in.Task != nil {
		if _, err = a.store.MakeStepTask(r.Context(), st.ID, auth.UserFrom(r.Context()).ID, *in.Task); err != nil {
			_ = a.store.DeleteRunbookStep(r.Context(), st.ID)
		}
	}
	respondStatus(w, http.StatusCreated, st, err)
}

// makeStepTask tracks an existing step as a daily task ({day, tz}).
func (a *API) makeStepTask(w http.ResponseWriter, r *http.Request) {
	var in store.StepTaskInput
	if err := decode(r, &in); err != nil {
		respond(w, nil, err)
		return
	}
	id := chi.URLParam(r, "id")
	if !a.requireStep(w, r, id) {
		return
	}
	taskID, err := a.store.MakeStepTask(r.Context(), id, auth.UserFrom(r.Context()).ID, in)
	respondStatus(w, http.StatusCreated, map[string]string{"task_id": taskID}, err)
}

// unlinkStepTask turns a step back into a plain checklist item; the task stays.
func (a *API) unlinkStepTask(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	if !a.requireStep(w, r, id) {
		return
	}
	err := a.store.UnlinkStepTask(r.Context(), id)
	respond(w, map[string]bool{"ok": true}, err)
}

// requireStep checks editor access to the task a step belongs to.
func (a *API) requireStep(w http.ResponseWriter, r *http.Request, stepID string) bool {
	task, err := a.store.RunbookStepTask(r.Context(), stepID)
	if err != nil {
		respond(w, nil, err)
		return false
	}
	return a.requireTask(w, r, task, levelEditor)
}

func (a *API) updateRunbookStep(w http.ResponseWriter, r *http.Request) {
	var in store.RunbookStepInput
	if err := decode(r, &in); err != nil {
		respond(w, nil, err)
		return
	}
	id := chi.URLParam(r, "id")
	if !a.requireStep(w, r, id) {
		return
	}
	st, err := a.store.UpdateRunbookStep(r.Context(), id, auth.UserFrom(r.Context()).ID, in)
	respond(w, st, err)
}

func (a *API) deleteRunbookStep(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	if !a.requireStep(w, r, id) {
		return
	}
	err := a.store.DeleteRunbookStep(r.Context(), id)
	respond(w, map[string]bool{"deleted": true}, err)
}

// --- templates (per workspace) ---

func (a *API) listRunbookTemplates(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	if !a.require(w, r, id, levelViewer) {
		return
	}
	list, err := a.store.RunbookTemplates(r.Context(), id)
	respond(w, list, err)
}

// saveRunbookTemplate stores the task's runbook as a template ({name}),
// replacing one with the same name.
func (a *API) saveRunbookTemplate(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Name string `json:"name"`
	}
	if err := decode(r, &in); err != nil {
		respond(w, nil, err)
		return
	}
	id := chi.URLParam(r, "id")
	if !a.requireTask(w, r, id, levelEditor) {
		return
	}
	t, err := a.store.SaveRunbookTemplate(r.Context(), id, in.Name, auth.UserFrom(r.Context()).ID)
	respondStatus(w, http.StatusCreated, t, err)
}

// applyRunbookTemplate appends a template ({template_id}) to the task's
// runbook; tz places the daily tasks of steps saved as tasks.
func (a *API) applyRunbookTemplate(w http.ResponseWriter, r *http.Request) {
	var in struct {
		TemplateID string `json:"template_id"`
		TZ         string `json:"tz"`
	}
	if err := decode(r, &in); err != nil {
		respond(w, nil, err)
		return
	}
	id := chi.URLParam(r, "id")
	if !a.requireTask(w, r, id, levelEditor) {
		return
	}
	if err := a.store.ApplyRunbookTemplate(r.Context(), id, in.TemplateID, auth.UserFrom(r.Context()).ID, in.TZ); err != nil {
		respond(w, nil, err)
		return
	}
	secs, err := a.store.Runbook(r.Context(), id)
	respond(w, secs, err)
}

func (a *API) deleteRunbookTemplate(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	ws, err := a.store.RunbookTemplateWorkspace(r.Context(), id)
	if err != nil {
		respond(w, nil, err)
		return
	}
	if !a.require(w, r, ws, levelEditor) {
		return
	}
	err = a.store.DeleteRunbookTemplate(r.Context(), id)
	respond(w, map[string]bool{"deleted": true}, err)
}
