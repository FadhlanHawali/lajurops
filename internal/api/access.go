package api

import (
	"net/http"

	"github.com/FadhlanHawali/lajurops/internal/auth"
	"github.com/FadhlanHawali/lajurops/internal/store"
)

// Access levels, lowest first. Admins (the Keycloak admin role) can do
// everything; other users have a per-workspace role (see store.WorkspaceRoles).
type level int

const (
	levelNone level = iota
	levelViewer
	levelEditor
	levelAdmin
)

func levelOf(role string) level {
	switch role {
	case store.RoleEditor:
		return levelEditor
	case store.RoleViewer:
		return levelViewer
	}
	return levelNone
}

// roles returns the caller's role per workspace id; nil for admins, who
// can access every workspace.
func (a *API) roles(r *http.Request) (map[string]string, error) {
	p := auth.From(r.Context())
	if p.IsAdmin {
		return nil, nil
	}
	return a.store.WorkspaceRoles(r.Context(), p.ID, a.cfg.DefaultWorkspaceRole)
}

// levelIn is the caller's access level in a workspace.
func (a *API) levelIn(r *http.Request, workspaceID string) (level, error) {
	if auth.From(r.Context()).IsAdmin {
		return levelAdmin, nil
	}
	roles, err := a.roles(r)
	if err != nil {
		return levelNone, err
	}
	return levelOf(roles[workspaceID]), nil
}

// visible lists the workspaces the caller can see; nil means all (admins).
func (a *API) visible(r *http.Request) ([]string, error) {
	roles, err := a.roles(r)
	if roles == nil || err != nil {
		return nil, err
	}
	out := []string{}
	for ws, role := range roles {
		if levelOf(role) >= levelViewer {
			out = append(out, ws)
		}
	}
	return out, nil
}

// canCreateWorkspaces: admins, and anyone who is an editor somewhere.
func (a *API) canCreateWorkspaces(r *http.Request) (bool, error) {
	roles, err := a.roles(r)
	if roles == nil || err != nil {
		return err == nil, err
	}
	for _, role := range roles {
		if role == store.RoleEditor {
			return true, nil
		}
	}
	return false, nil
}

// require checks the caller's level in a workspace and writes the error
// response when it's too low: workspaces they can't see at all are
// reported as not found, so their existence isn't leaked.
func (a *API) require(w http.ResponseWriter, r *http.Request, workspaceID string, min level) bool {
	l, err := a.levelIn(r, workspaceID)
	switch {
	case err != nil:
		respond(w, nil, err)
		return false
	case l < levelViewer:
		respond(w, nil, store.ErrNotFound)
		return false
	case l < min:
		forbidden(w, min)
		return false
	}
	return true
}

// requireTask checks access to a task's workspace.
func (a *API) requireTask(w http.ResponseWriter, r *http.Request, taskID string, min level) bool {
	ws, err := a.store.TaskWorkspace(r.Context(), taskID)
	if err != nil {
		respond(w, nil, err)
		return false
	}
	return a.require(w, r, ws, min)
}

func forbidden(w http.ResponseWriter, min level) {
	msg := "you need editor access to this workspace"
	if min == levelAdmin {
		msg = "this needs an administrator"
	}
	writeJSON(w, http.StatusForbidden, map[string]string{"error": msg})
}
