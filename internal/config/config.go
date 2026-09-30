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
	// http://localhost:8081/realms/lajurops. Tokens are validated against it.
	OIDCIssuer string
	// OIDCJWKSURL is where the backend fetches signing keys. Defaults to the
	// issuer's certs endpoint; override when the backend reaches Keycloak on
	// a different (internal) hostname, e.g. inside docker compose.
	OIDCJWKSURL string
	// OIDCClientID is the public client used by the frontend. Access tokens
	// must be issued to this client (azp claim).
	OIDCClientID string

	// AdminRole is the Keycloak realm role that grants access to user management.
	AdminRole string
	// KeycloakAdminURL is the Keycloak base URL the backend uses for the Admin
	// REST API (e.g. http://keycloak:8080). Defaults to the issuer's base URL.
	KeycloakAdminURL string
	// KeycloakAdminClientID/Secret are a confidential client with a service
	// account holding realm-management roles. User management is disabled
	// when the secret is empty.
	KeycloakAdminClientID     string
	KeycloakAdminClientSecret string

	// ImportAllowPrivateURLs lets "import from URL" reach private/internal
	// addresses (e.g. an intranet file server). Off by default to prevent
	// the server being used to probe internal services.
	ImportAllowPrivateURLs bool
}

// UserManagementEnabled reports whether the Keycloak Admin API is configured.
func (c Config) UserManagementEnabled() bool {
	return !c.AuthDisabled && c.KeycloakAdminClientSecret != ""
}

func Load() (Config, error) {
	c := Config{
		Addr:         env("ADDR", ":8080"),
		DatabaseURL:  env("DATABASE_URL", "postgres://planner:planner@localhost:5432/planner?sslmode=disable"),
		OIDCIssuer:   strings.TrimRight(os.Getenv("OIDC_ISSUER"), "/"),
		OIDCJWKSURL:  os.Getenv("OIDC_JWKS_URL"),
		OIDCClientID: env("OIDC_CLIENT_ID", "lajurops"),

		AdminRole:                 env("ADMIN_ROLE", "lajurops-admin"),
		KeycloakAdminURL:          strings.TrimRight(os.Getenv("KEYCLOAK_ADMIN_URL"), "/"),
		KeycloakAdminClientID:     env("KEYCLOAK_ADMIN_CLIENT_ID", "lajurops-service"),
		KeycloakAdminClientSecret: os.Getenv("KEYCLOAK_ADMIN_CLIENT_SECRET"),
	}
	c.AuthDisabled, _ = strconv.ParseBool(os.Getenv("AUTH_DISABLED"))
	c.ImportAllowPrivateURLs, _ = strconv.ParseBool(os.Getenv("IMPORT_ALLOW_PRIVATE_URLS"))

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
		if c.KeycloakAdminURL == "" {
			c.KeycloakAdminURL, _, _ = c.KeycloakURLAndRealm()
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
