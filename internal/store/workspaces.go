package store

import (
	"context"
	"errors"
	"regexp"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

type Workspace struct {
	ID          string    `json:"id"`
	Key         string    `json:"key"`
	Name        string    `json:"name"`
	Description string    `json:"description"`
	TaskCount   int       `json:"task_count"`
	CreatedAt   time.Time `json:"created_at"`
}

type WorkspaceInput struct {
	Key         string `json:"key"`
	Name        string `json:"name"`
	Description string `json:"description"`
}

var workspaceKeyRe = regexp.MustCompile(`^[A-Z][A-Z0-9]{1,9}$`)

const workspaceCols = `p.id::text, p.key, p.name, p.description,
	(SELECT count(*) FROM tasks t WHERE t.workspace_id = p.id), p.created_at`

func scanWorkspace(row pgx.Row) (Workspace, error) {
	var p Workspace
	err := row.Scan(&p.ID, &p.Key, &p.Name, &p.Description, &p.TaskCount, &p.CreatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return p, ErrNotFound
	}
	return p, err
}

func (s *Store) ListWorkspaces(ctx context.Context) ([]Workspace, error) {
	rows, err := s.db.Query(ctx, `SELECT `+workspaceCols+` FROM workspaces p ORDER BY p.name`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Workspace{}
	for rows.Next() {
		p, err := scanWorkspace(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, p)
	}
	return out, rows.Err()
}

func (s *Store) GetWorkspace(ctx context.Context, id string) (Workspace, error) {
	return scanWorkspace(s.db.QueryRow(ctx, `SELECT `+workspaceCols+` FROM workspaces p WHERE p.id = $1`, id))
}

func (s *Store) CreateWorkspace(ctx context.Context, in WorkspaceInput, createdBy string) (Workspace, error) {
	in.Key = strings.ToUpper(strings.TrimSpace(in.Key))
	in.Name = strings.TrimSpace(in.Name)
	if !workspaceKeyRe.MatchString(in.Key) {
		return Workspace{}, invalid("workspace key must be 2-10 uppercase letters/digits, starting with a letter")
	}
	if in.Name == "" {
		return Workspace{}, invalid("workspace name is required")
	}
	var id string
	err := s.db.QueryRow(ctx, `
		INSERT INTO workspaces (key, name, description, created_by)
		VALUES ($1, $2, $3, $4) RETURNING id::text`,
		in.Key, in.Name, in.Description, nullString(createdBy),
	).Scan(&id)
	if err != nil {
		var pgErr *pgconn.PgError
		if errors.As(err, &pgErr) && pgErr.Code == "23505" {
			return Workspace{}, invalid("workspace key " + in.Key + " is already taken")
		}
		return Workspace{}, err
	}
	return s.GetWorkspace(ctx, id)
}

func (s *Store) UpdateWorkspace(ctx context.Context, id string, in WorkspaceInput) (Workspace, error) {
	in.Name = strings.TrimSpace(in.Name)
	if in.Name == "" {
		return Workspace{}, invalid("workspace name is required")
	}
	tag, err := s.db.Exec(ctx, `UPDATE workspaces SET name = $2, description = $3 WHERE id = $1`, id, in.Name, in.Description)
	if err != nil {
		return Workspace{}, err
	}
	if tag.RowsAffected() == 0 {
		return Workspace{}, ErrNotFound
	}
	return s.GetWorkspace(ctx, id)
}

func (s *Store) DeleteWorkspace(ctx context.Context, id string) error {
	tag, err := s.db.Exec(ctx, `DELETE FROM workspaces WHERE id = $1`, id)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

func nullString(s string) *string {
	if s == "" {
		return nil
	}
	return &s
}
