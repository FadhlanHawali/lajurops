package api

import (
	"net/http"

	"github.com/go-chi/chi/v5"

	"github.com/FadhlanHawali/open-planner/internal/store"
)

// listEnvironments returns a project's environments with usage counts.
func (a *API) listEnvironments(w http.ResponseWriter, r *http.Request) {
	envs, err := a.store.ListEnvironments(r.Context(), chi.URLParam(r, "id"))
	respond(w, envs, err)
}

// setEnvironments replaces a project's environment list (see store.SetEnvironments).
func (a *API) setEnvironments(w http.ResponseWriter, r *http.Request) {
	var in []store.EnvironmentInput
	if err := decode(r, &in); err != nil {
		respond(w, nil, err)
		return
	}
	envs, err := a.store.SetEnvironments(r.Context(), chi.URLParam(r, "id"), in)
	respond(w, envs, err)
}
