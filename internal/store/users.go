package store

import (
	"context"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"
)

type User struct {
	ID          string    `json:"id"`
	Username    string    `json:"username"`
	Email       string    `json:"email"`
	DisplayName string    `json:"display_name"`
	Active      bool      `json:"active"`
	LastSeenAt  time.Time `json:"last_seen_at"`
	// DeletedAt is set once the user no longer exists in Keycloak. The row
	// stays so past assignments, comments and reports keep their names.
	DeletedAt *time.Time `json:"deleted_at"`
}

const userCols = `id::text, username, email, display_name, active, last_seen_at, deleted_at`

func scanUser(row interface{ Scan(...any) error }) (User, error) {
	var u User
	err := row.Scan(&u.ID, &u.Username, &u.Email, &u.DisplayName, &u.Active, &u.LastSeenAt, &u.DeletedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return u, ErrNotFound
	}
	return u, err
}

// UpsertUser records a Keycloak identity, refreshing profile fields on each login.
func (s *Store) UpsertUser(ctx context.Context, sub, username, email, displayName string) (User, error) {
	return scanUser(s.db.QueryRow(ctx, `
		INSERT INTO users (keycloak_sub, username, email, display_name)
		VALUES ($1, $2, $3, $4)
		ON CONFLICT (keycloak_sub) DO UPDATE
		   SET username = EXCLUDED.username,
		       email = EXCLUDED.email,
		       display_name = EXCLUDED.display_name,
		       active = true,
		       deleted_at = NULL,
		       last_seen_at = now()
		RETURNING `+userCols,
		sub, username, email, displayName))
}

// SyncUser mirrors a user managed in Keycloak (by its id, which is the token
// sub) so they can be assigned tasks before their first login.
func (s *Store) SyncUser(ctx context.Context, sub, username, email, displayName string, active bool) error {
	_, err := s.db.Exec(ctx, `
		INSERT INTO users (keycloak_sub, username, email, display_name, active)
		VALUES ($1, $2, $3, $4, $5)
		ON CONFLICT (keycloak_sub) DO UPDATE
		   SET username = EXCLUDED.username,
		       email = EXCLUDED.email,
		       display_name = EXCLUDED.display_name,
		       active = EXCLUDED.active,
		       deleted_at = NULL`,
		sub, username, email, displayName, active)
	return err
}

// MarkDeleted flags a user that was deleted in Keycloak, keeping their history.
func (s *Store) MarkDeleted(ctx context.Context, sub string) error {
	_, err := s.db.Exec(ctx, `UPDATE users SET active = false, deleted_at = coalesce(deleted_at, now()) WHERE keycloak_sub = $1`, sub)
	return err
}

// KeycloakUser is the part of a Keycloak account the planner mirrors.
type KeycloakUser struct {
	Sub, Username, Email, DisplayName string
	Enabled                           bool
}

type SyncResult struct {
	InKeycloak    int      `json:"in_keycloak"`
	MarkedDeleted []string `json:"marked_deleted"`
	Restored      []string `json:"restored"`
}

// SyncAll mirrors the complete Keycloak user list: everyone in it is
// upserted, and planner users missing from it are marked deleted.
func (s *Store) SyncAll(ctx context.Context, users []KeycloakUser) (SyncResult, error) {
	res := SyncResult{InKeycloak: len(users), MarkedDeleted: []string{}, Restored: []string{}}
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return res, err
	}
	defer tx.Rollback(ctx)

	subs := make([]string, 0, len(users))
	for _, u := range users {
		subs = append(subs, u.Sub)
		var wasDeleted bool
		err := tx.QueryRow(ctx, `
			INSERT INTO users (keycloak_sub, username, email, display_name, active)
			VALUES ($1, $2, $3, $4, $5)
			ON CONFLICT (keycloak_sub) DO UPDATE
			   SET username = EXCLUDED.username,
			       email = EXCLUDED.email,
			       display_name = EXCLUDED.display_name,
			       active = EXCLUDED.active,
			       deleted_at = NULL
			RETURNING coalesce((SELECT deleted_at IS NOT NULL FROM users WHERE keycloak_sub = $1), false)`,
			u.Sub, u.Username, u.Email, u.DisplayName, u.Enabled).Scan(&wasDeleted)
		if err != nil {
			return res, err
		}
		if wasDeleted {
			res.Restored = append(res.Restored, u.Username)
		}
	}

	rows, err := tx.Query(ctx, `
		UPDATE users SET active = false, deleted_at = now()
		WHERE deleted_at IS NULL AND NOT (keycloak_sub = ANY($1))
		RETURNING username`, subs)
	if err != nil {
		return res, err
	}
	for rows.Next() {
		var name string
		if err := rows.Scan(&name); err != nil {
			rows.Close()
			return res, err
		}
		res.MarkedDeleted = append(res.MarkedDeleted, name)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return res, err
	}
	return res, tx.Commit(ctx)
}

func (s *Store) ListUsers(ctx context.Context) ([]User, error) {
	rows, err := s.db.Query(ctx, `
		SELECT `+userCols+`
		FROM users ORDER BY lower(coalesce(nullif(display_name, ''), username))`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	users := []User{}
	for rows.Next() {
		u, err := scanUser(rows)
		if err != nil {
			return nil, err
		}
		users = append(users, u)
	}
	return users, rows.Err()
}

// RemovedUser is a planner user deleted in Keycloak, with what's attached to them.
type RemovedUser struct {
	User
	Sub string `json:"sub"`
	// SoleTasks are tasks only this user owns and that contain nothing owned
	// by anyone else: these are deleted when removing "with tasks".
	SoleTasks int `json:"sole_tasks"`
	// SharedTasks are other assigned tasks; they are only unassigned.
	SharedTasks int `json:"shared_tasks"`
	Comments    int `json:"comments"`
}

// deletableTasks selects tasks owned only by user $1 whose whole subtree
// contains no task owned by anyone else, so deleting them never removes
// another person's work.
const deletableTasks = `
	WITH RECURSIVE sole AS (
		SELECT a.task_id AS id FROM task_assignees a
		WHERE a.user_id = $1
		  AND NOT EXISTS (SELECT 1 FROM task_assignees o WHERE o.task_id = a.task_id AND o.user_id <> $1)
	),
	tree(root, id) AS (
		SELECT id, id FROM sole
		UNION ALL
		SELECT tree.root, t.id FROM tasks t JOIN tree ON t.parent_id = tree.id
	)
	SELECT root FROM tree
	GROUP BY root
	HAVING bool_and(NOT EXISTS (SELECT 1 FROM task_assignees o WHERE o.task_id = tree.id AND o.user_id <> $1))`

func (s *Store) ListRemovedUsers(ctx context.Context) ([]RemovedUser, error) {
	rows, err := s.db.Query(ctx, `SELECT `+userCols+`, keycloak_sub FROM users WHERE deleted_at IS NOT NULL ORDER BY deleted_at DESC`)
	if err != nil {
		return nil, err
	}
	out := []RemovedUser{}
	for rows.Next() {
		var r RemovedUser
		if err := rows.Scan(&r.ID, &r.Username, &r.Email, &r.DisplayName, &r.Active, &r.LastSeenAt, &r.DeletedAt, &r.Sub); err != nil {
			rows.Close()
			return nil, err
		}
		out = append(out, r)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return nil, err
	}
	for i := range out {
		r := &out[i]
		if err := s.db.QueryRow(ctx, `SELECT count(*) FROM (`+deletableTasks+`) d`, r.ID).Scan(&r.SoleTasks); err != nil {
			return nil, err
		}
		if err := s.db.QueryRow(ctx, `SELECT count(*) FROM task_assignees WHERE user_id = $1`, r.ID).Scan(&r.SharedTasks); err != nil {
			return nil, err
		}
		r.SharedTasks -= r.SoleTasks
		if err := s.db.QueryRow(ctx, `SELECT count(*) FROM task_comments WHERE author_id = $1`, r.ID).Scan(&r.Comments); err != nil {
			return nil, err
		}
	}
	return out, nil
}

func (s *Store) GetRemovedUser(ctx context.Context, id string) (RemovedUser, error) {
	list, err := s.ListRemovedUsers(ctx)
	if err != nil {
		return RemovedUser{}, err
	}
	for _, r := range list {
		if r.ID == id {
			return r, nil
		}
	}
	return RemovedUser{}, ErrNotFound
}

type PurgeResult struct {
	DeletedTasks    int `json:"deleted_tasks"`
	UnassignedTasks int `json:"unassigned_tasks"`
}

// PurgeUser removes a user deleted in Keycloak from the planner. With
// deleteTasks, tasks only they own (see deletableTasks) are deleted along
// with their contents; every other assignment is simply removed. Their
// comments stay, shown as by a deleted user.
func (s *Store) PurgeUser(ctx context.Context, id string, deleteTasks bool) (PurgeResult, error) {
	var res PurgeResult
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return res, err
	}
	defer tx.Rollback(ctx)

	var deleted bool
	err = tx.QueryRow(ctx, `SELECT deleted_at IS NOT NULL FROM users WHERE id = $1 FOR UPDATE`, id).Scan(&deleted)
	if errors.Is(err, pgx.ErrNoRows) {
		return res, ErrNotFound
	} else if err != nil {
		return res, mapConstraintErr(err)
	}
	if !deleted {
		return res, invalid("only users deleted in Keycloak can be removed here")
	}

	if deleteTasks {
		tag, err := tx.Exec(ctx, `DELETE FROM tasks WHERE id IN (`+deletableTasks+`)`, id)
		if err != nil {
			return res, err
		}
		res.DeletedTasks = int(tag.RowsAffected())
	}
	tag, err := tx.Exec(ctx, `DELETE FROM task_assignees WHERE user_id = $1`, id)
	if err != nil {
		return res, err
	}
	res.UnassignedTasks = int(tag.RowsAffected())
	if _, err := tx.Exec(ctx, `DELETE FROM users WHERE id = $1`, id); err != nil {
		return res, err
	}
	return res, tx.Commit(ctx)
}
