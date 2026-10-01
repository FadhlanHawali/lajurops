package auth

import (
	"context"
	"fmt"
	"log/slog"
	"net/http"
	"slices"
	"strings"
	"sync"
	"time"

	"github.com/coreos/go-oidc/v3/oidc"

	"github.com/FadhlanHawali/lajurops/internal/config"
	"github.com/FadhlanHawali/lajurops/internal/store"
)

type ctxKey struct{}

// Principal is the authenticated caller.
type Principal struct {
	store.User
	// Sub is the Keycloak user id (the token's sub claim).
	Sub     string `json:"-"`
	IsAdmin bool   `json:"is_admin"`
}

// From returns the principal stored by Middleware.
func From(ctx context.Context) Principal {
	p, _ := ctx.Value(ctxKey{}).(Principal)
	return p
}

// UserFrom returns the authenticated user stored by Middleware.
func UserFrom(ctx context.Context) store.User { return From(ctx).User }

type Authenticator struct {
	verifier  *oidc.IDTokenVerifier
	clientID  string
	adminRole string
	disabled  bool
	store     *store.Store
	cache     sync.Map // sub -> cachedUser

	issuer  string
	jwksURL string
	hc      *http.Client
	rejects rejectLog
}

// New sets up token verification; hc is used for every call to Keycloak.
func New(ctx context.Context, cfg config.Config, st *store.Store, hc *http.Client) *Authenticator {
	a := &Authenticator{clientID: cfg.OIDCClientID, adminRole: cfg.AdminRole, disabled: cfg.AuthDisabled, store: st,
		issuer: cfg.OIDCIssuer, jwksURL: cfg.OIDCJWKSURL, hc: hc}
	if a.disabled {
		slog.Warn("AUTH_DISABLED=true: every request is treated as the local dev user")
		return a
	}
	// Verify against the public issuer, but fetch keys from OIDC_JWKS_URL, which
	// may use an internal hostname (e.g. http://keycloak:8080 inside compose).
	keys := oidc.NewRemoteKeySet(oidc.ClientContext(ctx, hc), cfg.OIDCJWKSURL)
	// Keycloak access tokens carry aud=account by default; the client is
	// identified by azp instead, which Middleware checks.
	a.verifier = oidc.NewVerifier(cfg.OIDCIssuer, keys, &oidc.Config{SkipClientIDCheck: true})
	slog.Info("auth: OIDC configured", "issuer", cfg.OIDCIssuer, "jwks_url", cfg.OIDCJWKSURL, "client_id", cfg.OIDCClientID, "admin_role", cfg.AdminRole)
	go a.probe(ctx)
	return a
}

// claims is the profile part of the token; kept comparable for the cache.
type claims struct {
	Sub               string `json:"sub"`
	Azp               string `json:"azp"`
	PreferredUsername string `json:"preferred_username"`
	Email             string `json:"email"`
	Name              string `json:"name"`
}

type tokenClaims struct {
	claims
	RealmAccess struct {
		Roles []string `json:"roles"`
	} `json:"realm_access"`
}

func (a *Authenticator) Middleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var c claims
		var isAdmin bool
		if a.disabled {
			c = claims{Sub: "dev", PreferredUsername: "dev", Name: "Local Developer", Email: "dev@localhost"}
			isAdmin = true
		} else {
			raw, ok := strings.CutPrefix(r.Header.Get("Authorization"), "Bearer ")
			if !ok || raw == "" {
				a.reject(w, r, http.StatusUnauthorized, "missing bearer token", "the request has no Authorization: Bearer header")
				return
			}
			tok, err := a.verifier.Verify(r.Context(), raw)
			if err != nil {
				t, parsed := peek(raw)
				a.reject(w, r, http.StatusUnauthorized, "invalid token", a.explain(err, t, parsed),
					"err", err, "token_iss", t.Iss, "expected_iss", a.issuer, "token_azp", t.Azp, "kid", t.Kid, "alg", t.Alg,
					"token_exp", unixTime(t.Exp), "server_time", time.Now().UTC().Format(time.RFC3339), "jwks_url", a.jwksURL)
				return
			}
			var tc tokenClaims
			if err := tok.Claims(&tc); err != nil {
				a.reject(w, r, http.StatusUnauthorized, "invalid token", "cannot read token claims: "+err.Error())
				return
			}
			if tc.Azp != "" && tc.Azp != a.clientID {
				a.reject(w, r, http.StatusUnauthorized, "token not issued for this client",
					fmt.Sprintf("token was issued to client %q but OIDC_CLIENT_ID is %q", tc.Azp, a.clientID))
				return
			}
			c = tc.claims
			isAdmin = slices.Contains(tc.RealmAccess.Roles, a.adminRole)
			slog.Debug("auth: token accepted", "sub", c.Sub, "username", c.PreferredUsername, "admin", isAdmin, "path", r.URL.Path)
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
		p := Principal{User: u, Sub: c.Sub, IsAdmin: isAdmin}
		next.ServeHTTP(w, r.WithContext(context.WithValue(r.Context(), ctxKey{}, p)))
	})
}

type cachedUser struct {
	user    store.User
	claims  claims
	expires time.Time
}

// Forget drops a cached identity so the next request re-syncs it.
func (a *Authenticator) Forget(sub string) { a.cache.Delete(sub) }

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

func unixTime(sec int64) string {
	if sec == 0 {
		return ""
	}
	return time.Unix(sec, 0).UTC().Format(time.RFC3339)
}
