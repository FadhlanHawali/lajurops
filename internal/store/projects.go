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

type Project struct {
	ID          string    `json:"id"`
	Key         string    `json:"key"`
	Name        string    `json:"name"`
	Description string    `json:"description"`
	TaskCount   int       `json:"task_count"`
	CreatedAt   time.Time `json:"created_at"`
}

type ProjectInput struct {
	Key         string `json:"key"`
	Name        string `json:"name"`
	Description string `json:"description"`
}

var projectKeyRe = regexp.MustCompile(`^[A-Z][A-Z0-9]{1,9}$`)

const projectCols = `p.id::text, p.key, p.name, p.description,
	(SELECT count(*) FROM tasks t WHERE t.project_id = p.id), p.created_at`

func scanProject(row pgx.Row) (Project, error) {
	var p Project
	err := row.Scan(&p.ID, &p.Key, &p.Name, &p.Description, &p.TaskCount, &p.CreatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return p, ErrNotFound
	}
	return p, err
}

func (s *Store) ListProjects(ctx context.Context) ([]Project, error) {
	rows, err := s.db.Query(ctx, `SELECT `+projectCols+` FROM projects p ORDER BY p.name`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Project{}
	for rows.Next() {
		p, err := scanProject(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, p)
	}
	return out, rows.Err()
}

func (s *Store) GetProject(ctx context.Context, id string) (Project, error) {
	return scanProject(s.db.QueryRow(ctx, `SELECT `+projectCols+` FROM projects p WHERE p.id = $1`, id))
}

func (s *Store) CreateProject(ctx context.Context, in ProjectInput, createdBy string) (Project, error) {
	in.Key = strings.ToUpper(strings.TrimSpace(in.Key))
	in.Name = strings.TrimSpace(in.Name)
	if !projectKeyRe.MatchString(in.Key) {
		return Project{}, invalid("project key must be 2-10 uppercase letters/digits, starting with a letter")
	}
	if in.Name == "" {
		return Project{}, invalid("project name is required")
	}
	var id string
	err := s.db.QueryRow(ctx, `
		INSERT INTO projects (key, name, description, created_by)
		VALUES ($1, $2, $3, $4) RETURNING id::text`,
		in.Key, in.Name, in.Description, nullString(createdBy),
	).Scan(&id)
	if err != nil {
		var pgErr *pgconn.PgError
		if errors.As(err, &pgErr) && pgErr.Code == "23505" {
			return Project{}, invalid("project key " + in.Key + " is already taken")
		}
		return Project{}, err
	}
	return s.GetProject(ctx, id)
}

func (s *Store) UpdateProject(ctx context.Context, id string, in ProjectInput) (Project, error) {
	in.Name = strings.TrimSpace(in.Name)
	if in.Name == "" {
		return Project{}, invalid("project name is required")
	}
	tag, err := s.db.Exec(ctx, `UPDATE projects SET name = $2, description = $3 WHERE id = $1`, id, in.Name, in.Description)
	if err != nil {
		return Project{}, err
	}
	if tag.RowsAffected() == 0 {
		return Project{}, ErrNotFound
	}
	return s.GetProject(ctx, id)
}

func (s *Store) DeleteProject(ctx context.Context, id string) error {
	tag, err := s.db.Exec(ctx, `DELETE FROM projects WHERE id = $1`, id)
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
