package store

import (
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
	db *pgxpool.Pool
}

func New(db *pgxpool.Pool) *Store { return &Store{db: db} }
