package main

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/FadhlanHawali/open-planner/internal/api"
	"github.com/FadhlanHawali/open-planner/internal/auth"
	"github.com/FadhlanHawali/open-planner/internal/config"
	"github.com/FadhlanHawali/open-planner/internal/db"
	"github.com/FadhlanHawali/open-planner/internal/store"
	"github.com/FadhlanHawali/open-planner/web"
)

// version is set at build time via -ldflags "-X main.version=...".
var version = "dev"

func main() {
	if err := run(); err != nil {
		slog.Error("fatal", "err", err)
		os.Exit(1)
	}
}

func run() error {
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	cfg, err := config.Load()
	if err != nil {
		return err
	}

	pool, err := db.Connect(ctx, cfg.DatabaseURL)
	if err != nil {
		return err
	}
	defer pool.Close()
	if err := db.Migrate(ctx, pool); err != nil {
		return err
	}

	st := store.New(pool)
	srv := &http.Server{
		Addr:              cfg.Addr,
		Handler:           api.Router(cfg, st, auth.New(ctx, cfg, st), web.Handler()),
		ReadHeaderTimeout: 10 * time.Second,
	}

	go func() {
		<-ctx.Done()
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		srv.Shutdown(shutdownCtx)
	}()

	slog.Info("open-planner listening", "version", version, "addr", cfg.Addr, "auth", !cfg.AuthDisabled)
	if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
		return err
	}
	return nil
}
