package store

import (
	"context"
	"errors"

	"github.com/jackc/pgx/v5"
)

// Workspace roles for non-admin users (see migration 010).
const (
	RoleEditor = "editor"
	RoleViewer = "viewer"
	RoleNone   = "none"
)

// ValidRole reports whether r is a role that can be stored for a member.
func ValidRole(r string) bool { return r == RoleEditor || r == RoleViewer || r == RoleNone }

// WorkspaceRoles returns the user's role in every workspace: their explicit
// role, or defaultRole where none is set.
func (s *Store) WorkspaceRoles(ctx context.Context, userID, defaultRole string) (map[string]string, error) {
	rows, err := s.db.Query(ctx, `
		SELECT w.id::text, coalesce(m.role, $2)
		FROM workspaces w
		LEFT JOIN workspace_members m ON m.workspace_id = w.id AND m.user_id = $1`, userID, defaultRole)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := map[string]string{}
	for rows.Next() {
		var ws, role string
		if err := rows.Scan(&ws, &role); err != nil {
			return nil, err
		}
		out[ws] = role
	}
	return out, rows.Err()
}

// MemberAccess is one row of a user's access list, for the admin UI.
type MemberAccess struct {
	WorkspaceID string `json:"workspace_id"`
	Key         string `json:"key"`
	Name        string `json:"name"`
	Role        string `json:"role"`
	// Explicit is false when Role is the server default.
	Explicit bool `json:"explicit"`
}

// UserAccess lists every workspace with the user's role in it.
func (s *Store) UserAccess(ctx context.Context, userID, defaultRole string) ([]MemberAccess, error) {
	rows, err := s.db.Query(ctx, `
		SELECT w.id::text, w.key, w.name, coalesce(m.role, $2), m.role IS NOT NULL
		FROM workspaces w
		LEFT JOIN workspace_members m ON m.workspace_id = w.id AND m.user_id = $1
		ORDER BY w.name`, userID, defaultRole)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []MemberAccess{}
	for rows.Next() {
		var a MemberAccess
		if err := rows.Scan(&a.WorkspaceID, &a.Key, &a.Name, &a.Role, &a.Explicit); err != nil {
			return nil, err
		}
		out = append(out, a)
	}
	return out, rows.Err()
}

// SetUserAccess stores explicit roles for a user, keyed by workspace id.
func (s *Store) SetUserAccess(ctx context.Context, userID string, roles map[string]string) error {
	for _, role := range roles {
		if !ValidRole(role) {
			return invalid("role must be editor, viewer or none")
		}
	}
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	for ws, role := range roles {
		if _, err := tx.Exec(ctx, `
			INSERT INTO workspace_members (workspace_id, user_id, role) VALUES ($1, $2, $3)
			ON CONFLICT (workspace_id, user_id) DO UPDATE SET role = excluded.role`, ws, userID, role); err != nil {
			return mapConstraintErr(err)
		}
	}
	return tx.Commit(ctx)
}

// SetMember gives one user a role in one workspace (e.g. its creator).
func (s *Store) SetMember(ctx context.Context, workspaceID, userID, role string) error {
	return s.SetUserAccess(ctx, userID, map[string]string{workspaceID: role})
}

// TaskWorkspace returns the workspace a task belongs to.
func (s *Store) TaskWorkspace(ctx context.Context, taskID string) (string, error) {
	var ws string
	err := s.db.QueryRow(ctx, `SELECT workspace_id::text FROM tasks WHERE id = $1`, taskID).Scan(&ws)
	return ws, notFound(err)
}

// CommentWorkspace returns the workspace of the task a comment is on.
func (s *Store) CommentWorkspace(ctx context.Context, commentID string) (string, error) {
	var ws string
	err := s.db.QueryRow(ctx, `
		SELECT t.workspace_id::text FROM task_comments c JOIN tasks t ON t.id = c.task_id WHERE c.id = $1`, commentID).Scan(&ws)
	return ws, notFound(err)
}

// UserIDBySub maps a Keycloak user id to the local user id.
func (s *Store) UserIDBySub(ctx context.Context, sub string) (string, error) {
	var id string
	err := s.db.QueryRow(ctx, `SELECT id::text FROM users WHERE keycloak_sub = $1`, sub).Scan(&id)
	return id, notFound(err)
}

func notFound(err error) error {
	if err == nil {
		return nil
	}
	if errors.Is(err, pgx.ErrNoRows) {
		return ErrNotFound
	}
	return mapConstraintErr(err)
}
