package api

import (
	"net/http"

	"github.com/go-chi/chi/v5"

	"github.com/FadhlanHawali/lajurops/internal/store"
)

func (a *API) listCategories(w http.ResponseWriter, r *http.Request) {
	if !a.require(w, r, chi.URLParam(r, "id"), levelViewer) {
		return
	}
	list, err := a.store.ListCategories(r.Context(), chi.URLParam(r, "id"))
	respond(w, list, err)
}

// setCategories replaces a workspace's project categories (see store.SetCategories).
func (a *API) setCategories(w http.ResponseWriter, r *http.Request) {
	var in []store.CategoryInput
	if err := decode(r, &in); err != nil {
		respond(w, nil, err)
		return
	}
	if !a.require(w, r, chi.URLParam(r, "id"), levelEditor) {
		return
	}
	list, err := a.store.SetCategories(r.Context(), chi.URLParam(r, "id"), in)
	respond(w, list, err)
}
