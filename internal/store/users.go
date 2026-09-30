package store

import (
	"context"
	"time"
)

type User struct {
	ID          string    `json:"id"`
	Username    string    `json:"username"`
	Email       string    `json:"email"`
	DisplayName string    `json:"display_name"`
	Active      bool      `json:"active"`
	LastSeenAt  time.Time `json:"last_seen_at"`
}

const userCols = `id::text, username, email, display_name, active, last_seen_at`

func scanUser(row interface{ Scan(...any) error }) (User, error) {
	var u User
	err := row.Scan(&u.ID, &u.Username, &u.Email, &u.DisplayName, &u.Active, &u.LastSeenAt)
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
		       active = EXCLUDED.active`,
		sub, username, email, displayName, active)
	return err
}

// DeactivateUser hides a user deleted in Keycloak while keeping their history.
func (s *Store) DeactivateUser(ctx context.Context, sub string) error {
	_, err := s.db.Exec(ctx, `UPDATE users SET active = false WHERE keycloak_sub = $1`, sub)
	return err
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
