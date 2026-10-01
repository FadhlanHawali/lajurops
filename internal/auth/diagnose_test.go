package auth

import (
	"encoding/base64"
	"encoding/json"
	"errors"
	"strings"
	"testing"
	"time"
)

func fakeJWT(t *testing.T, claims map[string]any) string {
	t.Helper()
	enc := func(v any) string {
		b, err := json.Marshal(v)
		if err != nil {
			t.Fatal(err)
		}
		return base64.RawURLEncoding.EncodeToString(b)
	}
	return enc(map[string]string{"alg": "RS256", "kid": "k1"}) + "." + enc(claims) + ".c2ln"
}

func TestExplain(t *testing.T) {
	a := &Authenticator{issuer: "http://localhost:8081/realms/lajurops", jwksURL: "http://keycloak:8080/realms/lajurops/protocol/openid-connect/certs"}
	now := time.Now().Unix()
	cases := []struct {
		name   string
		claims map[string]any
		err    string
		want   string
	}{
		{"issuer", map[string]any{"iss": "http://10.0.0.5:8081/realms/lajurops", "exp": now + 60}, "oidc: id token issued by a different provider", "issuer mismatch"},
		{"expired", map[string]any{"iss": a.issuer, "exp": now - 3600}, "oidc: token is expired", "clocks disagree"},
		{"future", map[string]any{"iss": a.issuer, "exp": now + 7200, "iat": now + 3600}, "failed to verify signature", "issued in the future"},
		{"jwks", map[string]any{"iss": a.issuer, "exp": now + 60}, "failed to verify signature: fetching keys oidc: get keys failed", "cannot fetch signing keys"},
		{"signature", map[string]any{"iss": a.issuer, "exp": now + 60}, "failed to verify signature: failed to verify id token signature", "signature does not match"},
	}
	for _, c := range cases {
		tok, ok := peek(fakeJWT(t, c.claims))
		if !ok || tok.Kid != "k1" {
			t.Fatalf("%s: peek failed: %+v", c.name, tok)
		}
		if got := a.explain(errors.New(c.err), tok, ok); !strings.Contains(got, c.want) {
			t.Errorf("%s: explain = %q, want it to contain %q", c.name, got, c.want)
		}
	}
	if _, ok := peek("not-a-jwt"); ok {
		t.Error("peek accepted a non-JWT")
	}
}

func TestProxyHintRedactsPassword(t *testing.T) {
	t.Setenv("HTTP_PROXY", "http://user:secret@proxy.corp.example:3128")
	t.Setenv("NO_PROXY", "")
	h := proxyHint("http://keycloak:8080/certs")
	if !strings.Contains(h, "proxy.corp.example") || strings.Contains(h, "secret") {
		t.Errorf("proxyHint = %q", h)
	}
}
