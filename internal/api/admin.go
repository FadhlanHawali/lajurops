package api

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/FadhlanHawali/lajurops/internal/auth"
	"github.com/FadhlanHawali/lajurops/internal/keycloak"
	"github.com/FadhlanHawali/lajurops/internal/store"
)

// adminOnly rejects callers without the admin realm role, and reports when
// the Keycloak Admin API is not configured.
func (a *API) adminOnly(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !auth.From(r.Context()).IsAdmin {
			writeJSON(w, http.StatusForbidden, map[string]string{"error": "requires the " + a.cfg.AdminRole + " role"})
			return
		}
		if a.kc == nil {
			writeJSON(w, http.StatusServiceUnavailable, map[string]string{
				"error": "user management is not configured: set KEYCLOAK_ADMIN_CLIENT_SECRET (see README)",
			})
			return
		}
		next.ServeHTTP(w, r)
	})
}

type adminUser struct {
	ID              string     `json:"id"`
	Username        string     `json:"username"`
	Email           string     `json:"email"`
	FirstName       string     `json:"first_name"`
	LastName        string     `json:"last_name"`
	Enabled         bool       `json:"enabled"`
	EmailVerified   bool       `json:"email_verified"`
	IsAdmin         bool       `json:"is_admin"`
	RequiredActions []string   `json:"required_actions"`
	CreatedAt       *time.Time `json:"created_at"` // nil for imported users
}

func toAdminUser(u keycloak.User, admins map[string]bool) adminUser {
	actions := u.RequiredActions
	if actions == nil {
		actions = []string{}
	}
	au := adminUser{
		ID: u.ID, Username: u.Username, Email: u.Email, FirstName: u.FirstName, LastName: u.LastName,
		Enabled: u.Enabled, EmailVerified: u.EmailVerified, IsAdmin: admins[u.ID], RequiredActions: actions,
	}
	if u.CreatedTimestamp > 0 {
		t := time.UnixMilli(u.CreatedTimestamp)
		au.CreatedAt = &t
	}
	return au
}

// syncLocal mirrors a Keycloak user into the planner's users table so they can
// be assigned tasks right away.
func (a *API) syncLocal(ctx context.Context, u keycloak.User) {
	name := u.DisplayName()
	if err := a.store.SyncUser(ctx, u.ID, u.Username, u.Email, name, u.Enabled); err != nil {
		slog.Error("sync user", "user", u.Username, "err", err)
	}
	a.auth.Forget(u.ID)
}

func (a *API) adminListUsers(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	q := r.URL.Query()
	search := strings.TrimSpace(q.Get("search"))
	first, _ := strconv.Atoi(q.Get("first"))
	limit, _ := strconv.Atoi(q.Get("max"))
	if limit <= 0 || limit > 200 {
		limit = 25
	}

	users, err := a.kc.ListUsers(ctx, search, max(first, 0), limit)
	if err != nil {
		respondKC(w, err)
		return
	}
	total, err := a.kc.CountUsers(ctx, search)
	if err != nil {
		respondKC(w, err)
		return
	}
	admins, err := a.kc.RoleMemberIDs(ctx, a.cfg.AdminRole)
	if err != nil {
		respondKC(w, err)
		return
	}

	out := make([]adminUser, 0, len(users))
	for _, u := range users {
		if strings.HasPrefix(u.Username, "service-account-") {
			continue
		}
		a.syncLocal(ctx, u)
		out = append(out, toAdminUser(u, admins))
	}
	writeJSON(w, http.StatusOK, map[string]any{"users": out, "total": total})
}

type adminUserInput struct {
	Username          string  `json:"username"`
	Email             *string `json:"email"`
	FirstName         *string `json:"first_name"`
	LastName          *string `json:"last_name"`
	Enabled           *bool   `json:"enabled"`
	IsAdmin           *bool   `json:"is_admin"`
	Password          string  `json:"password"`
	TemporaryPassword bool    `json:"temporary_password"`
}

var usernameRe = regexp.MustCompile(`^[a-zA-Z0-9._@-]{2,64}$`)

func deref[T any](p *T) T {
	var zero T
	if p == nil {
		return zero
	}
	return *p
}

func (a *API) adminCreateUser(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	var in adminUserInput
	if err := decode(r, &in); err != nil {
		respond(w, nil, err)
		return
	}
	in.Username = strings.ToLower(strings.TrimSpace(in.Username))
	if !usernameRe.MatchString(in.Username) {
		respond(w, nil, store.InvalidError{Msg: "username must be 2-64 characters: letters, digits, . _ @ -"})
		return
	}
	if len(in.Password) < 8 {
		respond(w, nil, store.InvalidError{Msg: "password must be at least 8 characters"})
		return
	}
	u := keycloak.User{
		Username:      in.Username,
		Email:         strings.TrimSpace(deref(in.Email)),
		FirstName:     strings.TrimSpace(deref(in.FirstName)),
		LastName:      strings.TrimSpace(deref(in.LastName)),
		Enabled:       in.Enabled == nil || *in.Enabled,
		EmailVerified: true,
	}
	id, err := a.kc.CreateUser(ctx, u, in.Password, in.TemporaryPassword)
	if err != nil {
		respondKC(w, err)
		return
	}
	if deref(in.IsAdmin) {
		if err := a.kc.SetRealmRole(ctx, id, a.cfg.AdminRole, true); err != nil {
			respondKC(w, err)
			return
		}
	}
	a.respondAdminUser(w, r, id, http.StatusCreated)
}

func (a *API) adminUpdateUser(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	id := chi.URLParam(r, "id")
	var in adminUserInput
	if err := decode(r, &in); err != nil {
		respond(w, nil, err)
		return
	}
	self := id == auth.From(ctx).Sub
	if self && ((in.Enabled != nil && !*in.Enabled) || (in.IsAdmin != nil && !*in.IsAdmin)) {
		respond(w, nil, store.InvalidError{Msg: "you cannot disable yourself or remove your own admin role"})
		return
	}

	u, err := a.kc.GetUser(ctx, id)
	if err != nil {
		respondKC(w, err)
		return
	}
	if in.Email != nil {
		u.Email = strings.TrimSpace(*in.Email)
	}
	if in.FirstName != nil {
		u.FirstName = strings.TrimSpace(*in.FirstName)
	}
	if in.LastName != nil {
		u.LastName = strings.TrimSpace(*in.LastName)
	}
	if in.Enabled != nil {
		u.Enabled = *in.Enabled
	}
	if err := a.kc.UpdateUser(ctx, u); err != nil {
		respondKC(w, err)
		return
	}
	if in.IsAdmin != nil {
		if err := a.kc.SetRealmRole(ctx, id, a.cfg.AdminRole, *in.IsAdmin); err != nil {
			respondKC(w, err)
			return
		}
	}
	if in.Password != "" {
		if len(in.Password) < 8 {
			respond(w, nil, store.InvalidError{Msg: "password must be at least 8 characters"})
			return
		}
		if err := a.kc.ResetPassword(ctx, id, in.Password, in.TemporaryPassword); err != nil {
			respondKC(w, err)
			return
		}
	}
	a.respondAdminUser(w, r, id, http.StatusOK)
}

func (a *API) adminDeleteUser(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	id := chi.URLParam(r, "id")
	if id == auth.From(ctx).Sub {
		respond(w, nil, store.InvalidError{Msg: "you cannot delete yourself"})
		return
	}
	if err := a.kc.DeleteUser(ctx, id); err != nil {
		respondKC(w, err)
		return
	}
	// Keep the local row so past assignments and reports stay intact; it
	// shows under "Deleted in Keycloak" where it can be removed for good.
	if err := a.store.MarkDeleted(ctx, id); err != nil {
		respond(w, nil, err)
		return
	}
	a.auth.Forget(id)
	writeJSON(w, http.StatusOK, map[string]bool{"deleted": true})
}

func (a *API) respondAdminUser(w http.ResponseWriter, r *http.Request, id string, status int) {
	ctx := r.Context()
	u, err := a.kc.GetUser(ctx, id)
	if err != nil {
		respondKC(w, err)
		return
	}
	admins, err := a.kc.RoleMemberIDs(ctx, a.cfg.AdminRole)
	if err != nil {
		respondKC(w, err)
		return
	}
	a.syncLocal(ctx, u)
	writeJSON(w, status, toAdminUser(u, admins))
}

// respondKC maps Keycloak errors to API responses.
func respondKC(w http.ResponseWriter, err error) {
	var ke *keycloak.Error
	if errors.As(err, &ke) {
		switch ke.Status {
		case http.StatusBadRequest, http.StatusConflict:
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": ke.Message})
			return
		case http.StatusNotFound:
			writeJSON(w, http.StatusNotFound, map[string]string{"error": "not found"})
			return
		}
	}
	slog.Error("keycloak admin call failed", "err", err)
	writeJSON(w, http.StatusBadGateway, map[string]string{"error": "identity provider request failed"})
}

// adminSyncUsers mirrors every Keycloak user into the planner and marks
// planner users that no longer exist in Keycloak as deleted.
func (a *API) adminSyncUsers(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	users, err := a.kc.ListAllUsers(ctx)
	if err != nil {
		respondKC(w, err)
		return
	}
	in := make([]store.KeycloakUser, 0, len(users))
	for _, u := range users {
		if strings.HasPrefix(u.Username, "service-account-") {
			continue
		}
		in = append(in, store.KeycloakUser{Sub: u.ID, Username: u.Username, Email: u.Email, DisplayName: u.DisplayName(), Enabled: u.Enabled})
		a.auth.Forget(u.ID)
	}
	res, err := a.store.SyncAll(ctx, in)
	respond(w, res, err)
}

func (a *API) adminRemovedUsers(w http.ResponseWriter, r *http.Request) {
	list, err := a.store.ListRemovedUsers(r.Context())
	respond(w, list, err)
}

// adminPurgeUser removes a user deleted in Keycloak from the planner,
// optionally deleting the tasks only they own.
func (a *API) adminPurgeUser(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	u, err := a.store.GetRemovedUser(ctx, chi.URLParam(r, "id"))
	if err != nil {
		respond(w, nil, err)
		return
	}
	// Refuse if the account came back in Keycloak since it was marked.
	if _, err := a.kc.GetUser(ctx, u.Sub); err == nil {
		respond(w, nil, store.InvalidError{Msg: u.Username + " still exists in Keycloak; run Sync first"})
		return
	} else {
		var ke *keycloak.Error
		if !errors.As(err, &ke) || ke.Status != http.StatusNotFound {
			respondKC(w, err)
			return
		}
	}
	res, err := a.store.PurgeUser(ctx, u.ID, r.URL.Query().Get("delete_tasks") == "true")
	a.auth.Forget(u.Sub)
	respond(w, res, err)
}
