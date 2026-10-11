package store

import (
	"context"
	"errors"

	"github.com/jackc/pgx/v5/pgxpool"
)

var (
	ErrNotFound = errors.New("not found")
	ErrInvalid  = errors.New("invalid input")
)

// InvalidError wraps ErrInvalid with a user-facing message.
type InvalidError struct{ Msg string }

func (e InvalidError) Error() string { return e.Msg }
func (e InvalidError) Unwrap() error { return ErrInvalid }

func invalid(msg string) error { return InvalidError{Msg: msg} }

type Store struct {
	db     *pgxpool.Pool
	health *health
}

func New(db *pgxpool.Pool) *Store { return &Store{db: db, health: newHealth()} }

// Ping checks that the database answers (for /readyz).
func (s *Store) Ping(ctx context.Context) error { return s.db.Ping(ctx) }
