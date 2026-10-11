package store

import (
	"context"
	"errors"
	"log/slog"
	"net"
	"sync"
	"sync/atomic"
	"time"

	"github.com/jackc/pgx/v5/pgconn"
)

// Database health: a background check pings Postgres every few seconds, so
// the API can answer "database unavailable" at once while it's down instead
// of hanging (a frozen database never answers) or failing with a vague 500.

const (
	healthEvery   = 3 * time.Second
	healthTimeout = 2 * time.Second
)

// health tracks whether the database answers. alive is canceled when an
// outage starts, which cancels the requests waiting on the database.
type health struct {
	down   atomic.Bool
	mu     sync.Mutex
	alive  context.Context
	cancel context.CancelFunc
}

func newHealth() *health {
	h := &health{}
	h.alive, h.cancel = context.WithCancel(context.Background())
	return h
}

// DBAvailable reports whether the last check reached the database.
func (s *Store) DBAvailable() bool { return !s.health.down.Load() }

// DBAlive is canceled when the database becomes unavailable; requests use it
// to stop waiting on a database that won't answer.
func (s *Store) DBAlive() context.Context {
	s.health.mu.Lock()
	defer s.health.mu.Unlock()
	return s.health.alive
}

// WatchDB checks the database every few seconds until ctx ends.
func (s *Store) WatchDB(ctx context.Context) {
	t := time.NewTicker(healthEvery)
	defer t.Stop()
	for {
		s.checkDB(ctx)
		select {
		case <-ctx.Done():
			return
		case <-t.C:
		}
	}
}

func (s *Store) checkDB(ctx context.Context) {
	pctx, cancel := context.WithTimeout(ctx, healthTimeout)
	err := s.db.Ping(pctx)
	cancel()
	if ctx.Err() != nil {
		return
	}
	h := s.health
	switch wasDown := h.down.Load(); {
	case err != nil && !wasDown:
		slog.Error("database unavailable: answering 503 until it's back", "err", err)
		h.mu.Lock()
		h.down.Store(true)
		h.cancel() // requests stuck on the database give up now
		h.mu.Unlock()
	case err == nil && wasDown:
		slog.Info("database is back")
		h.mu.Lock()
		h.alive, h.cancel = context.WithCancel(context.Background())
		h.down.Store(false)
		h.mu.Unlock()
	}
}

// IsUnavailable reports whether err means the database couldn't be reached
// (as opposed to a query that's wrong): connection failures, timeouts, and
// requests canceled because the database went away.
func (s *Store) IsUnavailable(err error) bool {
	if err == nil {
		return false
	}
	var connect *pgconn.ConnectError
	var netErr net.Error
	switch {
	case errors.As(err, &connect), pgconn.Timeout(err), errors.As(err, &netErr):
		return true
	case errors.Is(err, context.Canceled), errors.Is(err, context.DeadlineExceeded):
		return !s.DBAvailable()
	}
	return err.Error() == "closed pool"
}
