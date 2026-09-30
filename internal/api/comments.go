package api

import (
	"net/http"

	"github.com/go-chi/chi/v5"

	"github.com/FadhlanHawali/lajurops/internal/auth"
	"github.com/FadhlanHawali/lajurops/internal/store"
)

type commentInput struct {
	Body string `json:"body"`
}

func (a *API) listComments(w http.ResponseWriter, r *http.Request) {
	comments, err := a.store.ListComments(r.Context(), chi.URLParam(r, "id"))
	respond(w, comments, err)
}

func (a *API) createComment(w http.ResponseWriter, r *http.Request) {
	var in commentInput
	if err := decode(r, &in); err != nil {
		respond(w, nil, err)
		return
	}
	ctx := r.Context()
	taskID := chi.URLParam(r, "id")
	if _, err := a.store.GetTask(ctx, taskID); err != nil {
		respond(w, nil, err)
		return
	}
	c, err := a.store.CreateComment(ctx, taskID, auth.UserFrom(ctx).ID, in.Body)
	respondStatus(w, http.StatusCreated, c, err)
}

// ownComment loads a comment and checks the caller may change it: authors
// can edit and delete their own comments; admins can also delete others'.
func (a *API) ownComment(w http.ResponseWriter, r *http.Request, allowAdmin bool) (store.Comment, bool) {
	ctx := r.Context()
	c, err := a.store.GetComment(ctx, chi.URLParam(r, "id"))
	if err != nil {
		respond(w, nil, err)
		return c, false
	}
	p := auth.From(ctx)
	if (c.AuthorID == nil || *c.AuthorID != p.ID) && !(allowAdmin && p.IsAdmin) {
		writeJSON(w, http.StatusForbidden, map[string]string{"error": "you can only change your own comments"})
		return c, false
	}
	return c, true
}

func (a *API) updateComment(w http.ResponseWriter, r *http.Request) {
	var in commentInput
	if err := decode(r, &in); err != nil {
		respond(w, nil, err)
		return
	}
	c, ok := a.ownComment(w, r, false)
	if !ok {
		return
	}
	c, err := a.store.UpdateComment(r.Context(), c.ID, in.Body)
	respond(w, c, err)
}

func (a *API) deleteComment(w http.ResponseWriter, r *http.Request) {
	c, ok := a.ownComment(w, r, true)
	if !ok {
		return
	}
	err := a.store.DeleteComment(r.Context(), c.ID)
	respond(w, map[string]bool{"deleted": true}, err)
}
