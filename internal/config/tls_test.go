package config

import (
	"encoding/pem"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestKeycloakHTTPClient(t *testing.T) {
	srv := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {}))
	defer srv.Close()

	get := func(c Config) error {
		hc, err := c.KeycloakHTTPClient()
		if err != nil {
			t.Fatal(err)
		}
		res, err := hc.Get(srv.URL)
		if err == nil {
			res.Body.Close()
		}
		return err
	}

	if err := get(Config{}); err == nil || !strings.Contains(err.Error(), "x509") {
		t.Fatalf("self-signed cert accepted by default: %v", err)
	}
	if err := get(Config{KeycloakTLSSkipVerify: true}); err != nil {
		t.Fatalf("skip verify: %v", err)
	}

	ca := filepath.Join(t.TempDir(), "ca.pem")
	pemBytes := pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: srv.Certificate().Raw})
	if err := os.WriteFile(ca, pemBytes, 0o600); err != nil {
		t.Fatal(err)
	}
	if err := get(Config{KeycloakCACert: ca}); err != nil {
		t.Fatalf("custom CA: %v", err)
	}

	if _, err := (Config{KeycloakCACert: filepath.Join(t.TempDir(), "missing.pem")}).KeycloakHTTPClient(); err == nil {
		t.Fatal("missing CA file accepted")
	}
}
