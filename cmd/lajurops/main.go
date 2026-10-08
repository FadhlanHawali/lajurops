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
	_ "time/tzdata" // runbook step tasks are placed on days in the user's time zone

	"github.com/FadhlanHawali/lajurops/internal/api"
	"github.com/FadhlanHawali/lajurops/internal/auth"
	"github.com/FadhlanHawali/lajurops/internal/config"
	"github.com/FadhlanHawali/lajurops/internal/db"
	"github.com/FadhlanHawali/lajurops/internal/keycloak"
	"github.com/FadhlanHawali/lajurops/internal/store"
	"github.com/FadhlanHawali/lajurops/web"
)

// version is set at build time via -ldflags "-X main.version=...".
var version = "dev"

func main() {
	if err := run(); err != nil {
		slog.Error("fatal", "err", err)
		os.Exit(1)
	}
}

// setupLogging applies LOG_LEVEL (debug, info, warn, error; default info).
func setupLogging() {
	var level slog.Level
	if v := os.Getenv("LOG_LEVEL"); v != "" {
		if err := level.UnmarshalText([]byte(v)); err != nil {
			slog.Warn("ignoring invalid LOG_LEVEL", "value", v)
		}
	}
	slog.SetDefault(slog.New(slog.NewTextHandler(os.Stderr, &slog.HandlerOptions{Level: level})))
}

func run() error {
	setupLogging()
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
	kcHTTP, err := cfg.KeycloakHTTPClient()
	if err != nil {
		return err
	}
	if cfg.KeycloakTLSSkipVerify && !cfg.AuthDisabled {
		slog.Warn("KEYCLOAK_TLS_SKIP_VERIFY=true: Keycloak's TLS certificate is NOT verified; prefer KEYCLOAK_CA_CERT")
	}
	var kc *keycloak.Client
	if cfg.UserManagementEnabled() {
		_, realm, _ := cfg.KeycloakURLAndRealm()
		kc = keycloak.New(cfg.KeycloakAdminURL, realm, cfg.KeycloakAdminClientID, cfg.KeycloakAdminClientSecret, kcHTTP)
	}
	srv := &http.Server{
		Addr:              cfg.Addr,
		Handler:           api.Router(cfg, st, auth.New(ctx, cfg, st, kcHTTP), kc, web.Handler()),
		ReadHeaderTimeout: 10 * time.Second,
	}

	go func() {
		<-ctx.Done()
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		srv.Shutdown(shutdownCtx)
	}()

	slog.Info("lajurops listening", "version", version, "addr", cfg.Addr, "auth", !cfg.AuthDisabled, "user_management", kc != nil)
	if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
		return err
	}
	return nil
}
