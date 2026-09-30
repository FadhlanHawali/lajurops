package api

import (
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/jackc/pgx/v5/pgconn"

	"github.com/FadhlanHawali/open-planner/internal/auth"
	"github.com/FadhlanHawali/open-planner/internal/config"
	"github.com/FadhlanHawali/open-planner/internal/keycloak"
	"github.com/FadhlanHawali/open-planner/internal/store"
)

type API struct {
	cfg   config.Config
	store *store.Store
	auth  *auth.Authenticator
	kc    *keycloak.Client // nil when user management is not configured
}

// Router mounts the JSON API under /api and serves the SPA for everything else.
func Router(cfg config.Config, st *store.Store, authn *auth.Authenticator, kc *keycloak.Client, spa http.Handler) http.Handler {
	a := &API{cfg: cfg, store: st, auth: authn, kc: kc}

	r := chi.NewRouter()
	r.Use(middleware.RealIP, middleware.Recoverer, middleware.Compress(5))
	r.Get("/healthz", func(w http.ResponseWriter, _ *http.Request) { w.Write([]byte("ok")) })

	r.Route("/api", func(r chi.Router) {
		r.Use(middleware.Logger)
		r.Get("/config", a.getConfig)

		r.Group(func(r chi.Router) {
			r.Use(authn.Middleware)
			r.Get("/me", a.getMe)
			r.Get("/users", a.listUsers)

			r.Get("/workspaces", a.listWorkspaces)
			r.Post("/workspaces", a.createWorkspace)
			r.Get("/workspaces/{id}", a.getWorkspace)
			r.Patch("/workspaces/{id}", a.updateWorkspace)
			r.Delete("/workspaces/{id}", a.deleteWorkspace)

			r.Get("/tasks", a.listTasks)
			r.Post("/tasks", a.createTask)
			r.Get("/tasks/{id}", a.getTask)
			r.Patch("/tasks/{id}", a.updateTask)
			r.Delete("/tasks/{id}", a.deleteTask)

			r.Get("/reports/workload", a.workloadReport)
			r.Get("/reports/workload/{userID}/tasks", a.workloadTasks)

			r.Route("/admin", func(r chi.Router) {
				r.Use(a.adminOnly)
				r.Get("/users", a.adminListUsers)
				r.Post("/users", a.adminCreateUser)
				r.Patch("/users/{id}", a.adminUpdateUser)
				r.Delete("/users/{id}", a.adminDeleteUser)
			})
		})

		r.NotFound(func(w http.ResponseWriter, _ *http.Request) {
			writeJSON(w, http.StatusNotFound, map[string]string{"error": "not found"})
		})
	})

	r.Handle("/*", spa)
	return r
}

func (a *API) getConfig(w http.ResponseWriter, _ *http.Request) {
	url, realm, _ := a.cfg.KeycloakURLAndRealm()
	writeJSON(w, http.StatusOK, map[string]any{
		"auth_enabled":      !a.cfg.AuthDisabled,
		"keycloak_url":      url,
		"keycloak_realm":    realm,
		"keycloak_clientId": a.cfg.OIDCClientID,
		"user_management":   a.kc != nil,
	})
}

func (a *API) getMe(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, auth.From(r.Context()))
}

func (a *API) listUsers(w http.ResponseWriter, r *http.Request) {
	users, err := a.store.ListUsers(r.Context())
	respond(w, users, err)
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(v)
}

// respond writes v as JSON, or maps err to an HTTP status.
func respond(w http.ResponseWriter, v any, err error) {
	respondStatus(w, http.StatusOK, v, err)
}

func respondStatus(w http.ResponseWriter, status int, v any, err error) {
	var inv store.InvalidError
	switch {
	case err == nil:
		writeJSON(w, status, v)
	case errors.Is(err, store.ErrNotFound), isBadUUID(err):
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "not found"})
	case errors.As(err, &inv):
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": inv.Msg})
	default:
		slog.Error("request failed", "err", err)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "internal error"})
	}
}

// isBadUUID reports a malformed id in the URL, which we treat as not found.
func isBadUUID(err error) bool {
	var pgErr *pgconn.PgError
	return errors.As(err, &pgErr) && pgErr.Code == "22P02"
}

func decode(r *http.Request, v any) error {
	dec := json.NewDecoder(http.MaxBytesReader(nil, r.Body, 1<<20))
	if err := dec.Decode(v); err != nil {
		return store.InvalidError{Msg: "invalid JSON body: " + err.Error()}
	}
	return nil
}

// parseRange reads RFC 3339 from/to query params.
func parseRange(r *http.Request) (from, to *time.Time, err error) {
	parse := func(name string) (*time.Time, error) {
		s := r.URL.Query().Get(name)
		if s == "" {
			return nil, nil
		}
		t, err := time.Parse(time.RFC3339, s)
		if err != nil {
			return nil, store.InvalidError{Msg: name + " must be an RFC 3339 timestamp"}
		}
		return &t, nil
	}
	if from, err = parse("from"); err != nil {
		return
	}
	to, err = parse("to")
	return
}
