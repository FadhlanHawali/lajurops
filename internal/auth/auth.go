package auth

import (
	"context"
	"log/slog"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/coreos/go-oidc/v3/oidc"

	"github.com/FadhlanHawali/open-planner/internal/config"
	"github.com/FadhlanHawali/open-planner/internal/store"
)

type ctxKey struct{}

// UserFrom returns the authenticated user stored by Middleware.
func UserFrom(ctx context.Context) store.User {
	u, _ := ctx.Value(ctxKey{}).(store.User)
	return u
}

type Authenticator struct {
	verifier *oidc.IDTokenVerifier
	clientID string
	disabled bool
	store    *store.Store
	cache    sync.Map // sub -> cachedUser
}

func New(ctx context.Context, cfg config.Config, st *store.Store) *Authenticator {
	a := &Authenticator{clientID: cfg.OIDCClientID, disabled: cfg.AuthDisabled, store: st}
	if a.disabled {
		slog.Warn("AUTH_DISABLED=true: every request is treated as the local dev user")
		return a
	}
	// Verify against the public issuer, but fetch keys from OIDC_JWKS_URL, which
	// may use an internal hostname (e.g. http://keycloak:8080 inside compose).
	keys := oidc.NewRemoteKeySet(ctx, cfg.OIDCJWKSURL)
	// Keycloak access tokens carry aud=account by default; the client is
	// identified by azp instead, which Middleware checks.
	a.verifier = oidc.NewVerifier(cfg.OIDCIssuer, keys, &oidc.Config{SkipClientIDCheck: true})
	return a
}

type claims struct {
	Sub               string `json:"sub"`
	Azp               string `json:"azp"`
	PreferredUsername string `json:"preferred_username"`
	Email             string `json:"email"`
	Name              string `json:"name"`
}

func (a *Authenticator) Middleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var c claims
		if a.disabled {
			c = claims{Sub: "dev", PreferredUsername: "dev", Name: "Local Developer", Email: "dev@localhost"}
		} else {
			raw, ok := strings.CutPrefix(r.Header.Get("Authorization"), "Bearer ")
			if !ok || raw == "" {
				http.Error(w, `{"error":"missing bearer token"}`, http.StatusUnauthorized)
				return
			}
			tok, err := a.verifier.Verify(r.Context(), raw)
			if err != nil {
				slog.Debug("token rejected", "err", err)
				http.Error(w, `{"error":"invalid token"}`, http.StatusUnauthorized)
				return
			}
			if err := tok.Claims(&c); err != nil || (c.Azp != "" && c.Azp != a.clientID) {
				http.Error(w, `{"error":"token not issued for this client"}`, http.StatusUnauthorized)
				return
			}
		}
		if c.PreferredUsername == "" {
			c.PreferredUsername = c.Sub
		}

		u, err := a.user(r.Context(), c)
		if err != nil {
			slog.Error("upsert user", "err", err)
			http.Error(w, `{"error":"internal error"}`, http.StatusInternalServerError)
			return
		}
		next.ServeHTTP(w, r.WithContext(context.WithValue(r.Context(), ctxKey{}, u)))
	})
}

type cachedUser struct {
	user    store.User
	claims  claims
	expires time.Time
}

// user maps token claims to a local user row, upserting at most once every
// few minutes per identity (or immediately when profile claims change).
func (a *Authenticator) user(ctx context.Context, c claims) (store.User, error) {
	if v, ok := a.cache.Load(c.Sub); ok {
		cu := v.(cachedUser)
		if cu.claims == c && time.Now().Before(cu.expires) {
			return cu.user, nil
		}
	}
	u, err := a.store.UpsertUser(ctx, c.Sub, c.PreferredUsername, c.Email, c.Name)
	if err != nil {
		return u, err
	}
	a.cache.Store(c.Sub, cachedUser{user: u, claims: c, expires: time.Now().Add(5 * time.Minute)})
	return u, nil
}
