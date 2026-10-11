package db

import (
	"context"
	"embed"
	"fmt"
	"io/fs"
	"log/slog"
	"sort"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

//go:embed migrations/*.sql
var migrations embed.FS

// Connect opens a pool, retrying for a while so the app can start alongside
// postgres in docker compose.
func Connect(ctx context.Context, url string) (*pgxpool.Pool, error) {
	cfg, err := pgxpool.ParseConfig(url)
	if err != nil {
		return nil, err
	}
	// JIT compilation costs hundreds of milliseconds per query once a plan's
	// estimated cost crosses jit_above_cost, which this app's short queries
	// never earn back. A jit setting in the DSN still wins.
	if _, ok := cfg.ConnConfig.RuntimeParams["jit"]; !ok {
		cfg.ConnConfig.RuntimeParams["jit"] = "off"
	}
	// Don't wait forever for a database that doesn't answer (connect_timeout
	// in the DSN still wins).
	if cfg.ConnConfig.ConnectTimeout == 0 {
		cfg.ConnConfig.ConnectTimeout = 5 * time.Second
	}
	pool, err := pgxpool.NewWithConfig(ctx, cfg)
	if err != nil {
		return nil, err
	}
	deadline := time.Now().Add(60 * time.Second)
	for {
		err = pool.Ping(ctx)
		if err == nil {
			return pool, nil
		}
		if time.Now().After(deadline) {
			pool.Close()
			return nil, fmt.Errorf("database not reachable: %w", err)
		}
		slog.Info("waiting for database", "err", err)
		time.Sleep(2 * time.Second)
	}
}

// migrateLock is the Postgres advisory lock key that serialises migrations
// (any fixed number; this one spells "lajurops").
const migrateLock int64 = 0x6c616a75726f7073

// Migrate applies embedded migrations in filename order, each exactly once.
// Replicas starting at the same time take turns: the first applies what's
// missing while the others wait for the lock, then find nothing to do.
func Migrate(ctx context.Context, pool *pgxpool.Pool) error {
	conn, err := pool.Acquire(ctx)
	if err != nil {
		return err
	}
	defer conn.Release()
	if _, err := conn.Exec(ctx, `SELECT pg_advisory_lock($1)`, migrateLock); err != nil {
		return fmt.Errorf("waiting for the migration lock: %w", err)
	}
	// Session lock: released explicitly, or by Postgres if this connection dies.
	defer conn.Exec(context.WithoutCancel(ctx), `SELECT pg_advisory_unlock($1)`, migrateLock)

	if _, err := conn.Exec(ctx, `CREATE TABLE IF NOT EXISTS schema_migrations (
		version text PRIMARY KEY,
		applied_at timestamptz NOT NULL DEFAULT now())`); err != nil {
		return err
	}

	names, err := fs.Glob(migrations, "migrations/*.sql")
	if err != nil {
		return err
	}
	sort.Strings(names)

	for _, name := range names {
		var exists bool
		if err := conn.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM schema_migrations WHERE version=$1)`, name).Scan(&exists); err != nil {
			return err
		}
		if exists {
			continue
		}
		sql, err := migrations.ReadFile(name)
		if err != nil {
			return err
		}
		tx, err := conn.Begin(ctx)
		if err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, string(sql)); err != nil {
			tx.Rollback(ctx)
			return fmt.Errorf("migration %s: %w", name, err)
		}
		if _, err := tx.Exec(ctx, `INSERT INTO schema_migrations(version) VALUES ($1)`, name); err != nil {
			tx.Rollback(ctx)
			return err
		}
		if err := tx.Commit(ctx); err != nil {
			return err
		}
		slog.Info("applied migration", "name", name)
	}
	return nil
}
