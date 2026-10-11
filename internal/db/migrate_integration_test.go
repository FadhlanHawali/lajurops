package db

import (
	"context"
	"fmt"
	"io/fs"
	"os"
	"sync"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

// Several replicas starting at once against an empty database: each
// migration runs once and every replica starts.
func TestMigrateConcurrently(t *testing.T) {
	url := os.Getenv("PLANNER_TEST_DATABASE_URL")
	if url == "" {
		t.Skip("PLANNER_TEST_DATABASE_URL not set")
	}
	ctx := context.Background()
	admin, err := pgxpool.New(ctx, url)
	if err != nil {
		t.Fatal(err)
	}
	defer admin.Close()
	name := fmt.Sprintf("lajurops_migrate_%d", time.Now().UnixNano())
	if _, err := admin.Exec(ctx, `CREATE DATABASE `+name); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { admin.Exec(ctx, `DROP DATABASE IF EXISTS `+name+` WITH (FORCE)`) })
	cfg, err := pgxpool.ParseConfig(url)
	if err != nil {
		t.Fatal(err)
	}
	cfg.ConnConfig.Database = name

	const replicas = 5
	var wg sync.WaitGroup
	errs := make([]error, replicas)
	for i := range replicas {
		wg.Add(1)
		go func() {
			defer wg.Done()
			pool, err := pgxpool.NewWithConfig(ctx, cfg.Copy())
			if err != nil {
				errs[i] = err
				return
			}
			defer pool.Close()
			errs[i] = Migrate(ctx, pool)
		}()
	}
	wg.Wait()
	for i, err := range errs {
		if err != nil {
			t.Errorf("replica %d: %v", i, err)
		}
	}
	files, _ := fs.Glob(migrations, "migrations/*.sql")
	pool, _ := pgxpool.NewWithConfig(ctx, cfg.Copy())
	defer pool.Close()
	var applied int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM schema_migrations`).Scan(&applied); err != nil || applied != len(files) {
		t.Errorf("applied %d migrations (%v), want %d", applied, err, len(files))
	}
}
