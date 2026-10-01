package config

import (
	"crypto/tls"
	"crypto/x509"
	"fmt"
	"net/http"
	"os"
	"time"
)

// KeycloakHTTPClient is the HTTP client for every server-side call to
// Keycloak (signing keys, Admin API). It trusts the system CAs plus
// KeycloakCACert, and skips verification only when KeycloakTLSSkipVerify.
func (c Config) KeycloakHTTPClient() (*http.Client, error) {
	tr := http.DefaultTransport.(*http.Transport).Clone()
	tlsCfg := &tls.Config{MinVersion: tls.VersionTLS12}
	if c.KeycloakCACert != "" {
		pem, err := os.ReadFile(c.KeycloakCACert)
		if err != nil {
			return nil, fmt.Errorf("KEYCLOAK_CA_CERT: %w", err)
		}
		pool, err := x509.SystemCertPool()
		if err != nil || pool == nil {
			pool = x509.NewCertPool()
		}
		if !pool.AppendCertsFromPEM(pem) {
			return nil, fmt.Errorf("KEYCLOAK_CA_CERT: no PEM certificates found in %s", c.KeycloakCACert)
		}
		tlsCfg.RootCAs = pool
	}
	if c.KeycloakTLSSkipVerify {
		tlsCfg.InsecureSkipVerify = true //nolint:gosec // explicit opt-in for internal CAs
	}
	tr.TLSClientConfig = tlsCfg
	return &http.Client{Transport: tr, Timeout: 15 * time.Second}, nil
}
