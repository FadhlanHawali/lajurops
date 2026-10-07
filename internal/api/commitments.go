package api

import (
	"net/http"
	"time"

	"github.com/FadhlanHawali/lajurops/internal/auth"
	"github.com/FadhlanHawali/lajurops/internal/store"
)

// parseWeek reads ?week, the start of a Monday as an RFC 3339 timestamp in
// the caller's time zone (e.g. 2026-10-05T00:00:00+07:00).
func parseWeek(r *http.Request) (time.Time, error) {
	t, err := time.Parse(time.RFC3339, r.URL.Query().Get("week"))
	if err != nil {
		return t, store.InvalidError{Msg: "week must be an RFC 3339 timestamp, e.g. 2026-10-05T00:00:00+07:00"}
	}
	return t, store.WeekStart(t)
}

// listCommitments is everyone's commitment for a week (the Team view),
// limited to ?workspace_id or the workspaces the caller can see.
func (a *API) listCommitments(w http.ResponseWriter, r *http.Request) {
	week, err := parseWeek(r)
	if err != nil {
		respond(w, nil, err)
		return
	}
	scope, ok := a.reportScope(w, r)
	if !ok {
		return
	}
	// Slim tasks: a big team's full task data runs to megabytes.
	list, err := a.store.Commitments(r.Context(), week, scope, "", true)
	out := make([]store.CommitmentBrief, len(list))
	for i, c := range list {
		out[i] = c.Brief()
	}
	respond(w, out, err)
}

// myCommitment is the caller's own commitment across every workspace they can see.
func (a *API) myCommitment(w http.ResponseWriter, r *http.Request) {
	week, err := parseWeek(r)
	if err != nil {
		respond(w, nil, err)
		return
	}
	visible, err := a.visible(r)
	if err != nil {
		respond(w, nil, err)
		return
	}
	list, err := a.store.Commitments(r.Context(), week, store.Scope(visible), auth.From(r.Context()).ID, false)
	if err == nil && len(list) == 0 {
		err = store.ErrNotFound
	}
	if err != nil {
		respond(w, nil, err)
		return
	}
	respond(w, list[0], nil)
}

// saveMyCommitment replaces the caller's commitment for a week. Committing
// to your own tasks is a personal plan, so viewers may commit too; taking
// an unassigned task, or scheduling an unscheduled one, changes the task
// and only happens in workspaces the caller can edit.
func (a *API) saveMyCommitment(w http.ResponseWriter, r *http.Request) {
	week, err := parseWeek(r)
	if err != nil {
		respond(w, nil, err)
		return
	}
	var in store.CommitmentInput
	if err := decode(r, &in); err != nil {
		respond(w, nil, err)
		return
	}
	visible, err := a.visible(r)
	if err != nil {
		respond(w, nil, err)
		return
	}
	editable, err := a.editable(r)
	if err != nil {
		respond(w, nil, err)
		return
	}
	if err := a.store.SaveCommitment(r.Context(), auth.From(r.Context()).ID, week, in, store.Scope(visible), store.Scope(editable)); err != nil {
		respond(w, nil, err)
		return
	}
	a.myCommitment(w, r)
}
