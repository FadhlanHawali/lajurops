package store

import (
	"context"
	"errors"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
)

// Comment is a Markdown note on a task. The body is stored as written and
// rendered by the frontend.
type Comment struct {
	ID        string    `json:"id"`
	TaskID    string    `json:"task_id"`
	AuthorID  *string   `json:"author_id"`
	Body      string    `json:"body"`
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

const maxCommentLen = 20000

const commentCols = `id::text, task_id::text, author_id::text, body, created_at, updated_at`

func scanComment(row pgx.Row) (Comment, error) {
	var c Comment
	err := row.Scan(&c.ID, &c.TaskID, &c.AuthorID, &c.Body, &c.CreatedAt, &c.UpdatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return c, ErrNotFound
	}
	return c, err
}

func cleanBody(body string) (string, error) {
	body = strings.TrimSpace(body)
	switch {
	case body == "":
		return "", invalid("comment cannot be empty")
	case len(body) > maxCommentLen:
		return "", invalid("comment is too long (max 20,000 characters)")
	}
	return body, nil
}

func (s *Store) ListComments(ctx context.Context, taskID string) ([]Comment, error) {
	rows, err := s.db.Query(ctx, `SELECT `+commentCols+` FROM task_comments WHERE task_id = $1 ORDER BY created_at`, taskID)
	if err != nil {
		return nil, mapConstraintErr(err)
	}
	defer rows.Close()
	out := []Comment{}
	for rows.Next() {
		c, err := scanComment(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, c)
	}
	return out, rows.Err()
}

func (s *Store) GetComment(ctx context.Context, id string) (Comment, error) {
	return scanComment(s.db.QueryRow(ctx, `SELECT `+commentCols+` FROM task_comments WHERE id = $1`, id))
}

func (s *Store) CreateComment(ctx context.Context, taskID, authorID, body string) (Comment, error) {
	body, err := cleanBody(body)
	if err != nil {
		return Comment{}, err
	}
	c, err := scanComment(s.db.QueryRow(ctx, `
		INSERT INTO task_comments (task_id, author_id, body) VALUES ($1, $2, $3)
		RETURNING `+commentCols, taskID, nullString(authorID), body))
	if err != nil {
		return c, mapConstraintErr(err)
	}
	return c, nil
}

func (s *Store) UpdateComment(ctx context.Context, id, body string) (Comment, error) {
	body, err := cleanBody(body)
	if err != nil {
		return Comment{}, err
	}
	return scanComment(s.db.QueryRow(ctx, `
		UPDATE task_comments SET body = $2, updated_at = now() WHERE id = $1
		RETURNING `+commentCols, id, body))
}

func (s *Store) DeleteComment(ctx context.Context, id string) error {
	tag, err := s.db.Exec(ctx, `DELETE FROM task_comments WHERE id = $1`, id)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}
