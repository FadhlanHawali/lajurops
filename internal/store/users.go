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
	LastSeenAt  time.Time `json:"last_seen_at"`
}

// UpsertUser records a Keycloak identity, refreshing profile fields on each login.
func (s *Store) UpsertUser(ctx context.Context, sub, username, email, displayName string) (User, error) {
	var u User
	err := s.db.QueryRow(ctx, `
		INSERT INTO users (keycloak_sub, username, email, display_name)
		VALUES ($1, $2, $3, $4)
		ON CONFLICT (keycloak_sub) DO UPDATE
		   SET username = EXCLUDED.username,
		       email = EXCLUDED.email,
		       display_name = EXCLUDED.display_name,
		       last_seen_at = now()
		RETURNING id::text, username, email, display_name, last_seen_at`,
		sub, username, email, displayName,
	).Scan(&u.ID, &u.Username, &u.Email, &u.DisplayName, &u.LastSeenAt)
	return u, err
}

func (s *Store) ListUsers(ctx context.Context) ([]User, error) {
	rows, err := s.db.Query(ctx, `
		SELECT id::text, username, email, display_name, last_seen_at
		FROM users ORDER BY lower(coalesce(nullif(display_name, ''), username))`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	users := []User{}
	for rows.Next() {
		var u User
		if err := rows.Scan(&u.ID, &u.Username, &u.Email, &u.DisplayName, &u.LastSeenAt); err != nil {
			return nil, err
		}
		users = append(users, u)
	}
	return users, rows.Err()
}
