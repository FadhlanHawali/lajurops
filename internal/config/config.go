package config

import (
	"fmt"
	"os"
	"strconv"
	"strings"
)

// Config holds runtime configuration, read from environment variables.
type Config struct {
	Addr        string
	DatabaseURL string

	// AuthDisabled skips Keycloak entirely and treats every request as a
	// single local "dev" user. Never enable this in production.
	AuthDisabled bool

	// OIDCIssuer is the issuer URL as seen by the browser, e.g.
	// http://localhost:8081/realms/open-planner. Tokens are validated against it.
	OIDCIssuer string
	// OIDCJWKSURL is where the backend fetches signing keys. Defaults to the
	// issuer's certs endpoint; override when the backend reaches Keycloak on
	// a different (internal) hostname, e.g. inside docker compose.
	OIDCJWKSURL string
	// OIDCClientID is the public client used by the frontend. Access tokens
	// must be issued to this client (azp claim).
	OIDCClientID string
}

func Load() (Config, error) {
	c := Config{
		Addr:         env("ADDR", ":8080"),
		DatabaseURL:  env("DATABASE_URL", "postgres://planner:planner@localhost:5432/planner?sslmode=disable"),
		OIDCIssuer:   strings.TrimRight(os.Getenv("OIDC_ISSUER"), "/"),
		OIDCJWKSURL:  os.Getenv("OIDC_JWKS_URL"),
		OIDCClientID: env("OIDC_CLIENT_ID", "open-planner"),
	}
	c.AuthDisabled, _ = strconv.ParseBool(os.Getenv("AUTH_DISABLED"))

	if !c.AuthDisabled {
		if c.OIDCIssuer == "" {
			return c, fmt.Errorf("OIDC_ISSUER is required (or set AUTH_DISABLED=true for local development)")
		}
		if _, _, ok := c.KeycloakURLAndRealm(); !ok {
			return c, fmt.Errorf("OIDC_ISSUER must look like https://<host>/realms/<realm>, got %q", c.OIDCIssuer)
		}
		if c.OIDCJWKSURL == "" {
			c.OIDCJWKSURL = c.OIDCIssuer + "/protocol/openid-connect/certs"
		}
	}
	return c, nil
}

// KeycloakURLAndRealm splits the issuer into the base URL and realm name that
// keycloak-js needs on the frontend.
func (c Config) KeycloakURLAndRealm() (url, realm string, ok bool) {
	i := strings.LastIndex(c.OIDCIssuer, "/realms/")
	if i < 0 {
		return "", "", false
	}
	realm = c.OIDCIssuer[i+len("/realms/"):]
	return c.OIDCIssuer[:i], realm, realm != "" && !strings.Contains(realm, "/")
}

func env(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}
