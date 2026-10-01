package auth

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"

	"golang.org/x/net/http/httpproxy"
)

// Diagnostics for rejected tokens. A misconfigured deployment rejects every
// request, so the reason has to be obvious from the logs (and the 401 body)
// without turning on debug logging.

// peekedToken holds claims read from a token WITHOUT verifying it. Only ever
// use it to explain a rejection, never to make an authorization decision.
type peekedToken struct {
	Kid string
	Alg string
	Iss string `json:"iss"`
	Azp string `json:"azp"`
	Exp int64  `json:"exp"`
	Iat int64  `json:"iat"`
	Nbf int64  `json:"nbf"`
}

func peek(raw string) (peekedToken, bool) {
	var t peekedToken
	parts := strings.Split(raw, ".")
	if len(parts) != 3 {
		return t, false
	}
	var hdr struct {
		Kid string `json:"kid"`
		Alg string `json:"alg"`
	}
	if b, err := base64.RawURLEncoding.DecodeString(parts[0]); err == nil {
		_ = json.Unmarshal(b, &hdr)
	}
	b, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil || json.Unmarshal(b, &t) != nil {
		return t, false
	}
	t.Kid, t.Alg = hdr.Kid, hdr.Alg
	return t, true
}

// explain turns a verification error into an actionable reason.
func (a *Authenticator) explain(err error, t peekedToken, ok bool) string {
	msg := err.Error()
	now := time.Now()
	switch {
	case !ok:
		return "the bearer token is not a JWT"
	case t.Iss != a.issuer:
		return fmt.Sprintf("issuer mismatch: the token was issued by %q but OIDC_ISSUER is %q. "+
			"Set PUBLIC_KEYCLOAK_URL (compose) or OIDC_ISSUER to the exact Keycloak URL the browser uses", t.Iss, a.issuer)
	case t.Exp != 0 && now.After(time.Unix(t.Exp, 0)):
		return fmt.Sprintf("token expired at %s but the server clock says %s; if the token is fresh, the server and Keycloak clocks disagree",
			time.Unix(t.Exp, 0).UTC().Format(time.RFC3339), now.UTC().Format(time.RFC3339))
	case t.Iat != 0 && time.Unix(t.Iat, 0).After(now.Add(time.Minute)):
		return fmt.Sprintf("token issued in the future (iat %s, server time %s): the server and Keycloak clocks disagree",
			time.Unix(t.Iat, 0).UTC().Format(time.RFC3339), now.UTC().Format(time.RFC3339))
	case strings.Contains(msg, "fetching keys") || strings.Contains(msg, "get keys"):
		return fmt.Sprintf("cannot fetch signing keys from OIDC_JWKS_URL %s%s: %s", a.jwksURL, proxyHint(a.jwksURL), msg)
	case strings.Contains(msg, "failed to verify signature"):
		return fmt.Sprintf("signature does not match any key at OIDC_JWKS_URL %s (token kid %q); check it points at the same realm as OIDC_ISSUER: %s",
			a.jwksURL, t.Kid, msg)
	}
	return msg
}

// proxyHint reports the HTTP proxy Go will use for url, if any. Container
// runtimes in corporate networks often inject HTTP_PROXY, which then also
// catches internal hostnames like http://keycloak:8080 unless NO_PROXY lists them.
func proxyHint(rawURL string) string {
	u, err := url.Parse(rawURL)
	if err != nil {
		return ""
	}
	// Same rules as http.ProxyFromEnvironment, without its process-wide cache.
	p, err := httpproxy.FromEnvironment().ProxyFunc()(u)
	if err != nil || p == nil {
		return ""
	}
	host := u.Hostname()
	return fmt.Sprintf(" (requests go through proxy %s; add %q to NO_PROXY if Keycloak is internal)", p.Redacted(), host)
}

// rejectLog logs each distinct rejection reason at Warn at most once a
// minute, so a broken setup is visible without flooding the logs.
type rejectLog struct {
	mu   sync.Mutex
	last map[string]time.Time
}

func (l *rejectLog) level(key string) slog.Level {
	l.mu.Lock()
	defer l.mu.Unlock()
	if l.last == nil {
		l.last = map[string]time.Time{}
	}
	if t, ok := l.last[key]; ok && time.Since(t) < time.Minute {
		return slog.LevelDebug
	}
	l.last[key] = time.Now()
	return slog.LevelWarn
}

func (a *Authenticator) reject(w http.ResponseWriter, r *http.Request, status int, msg, reason string, attrs ...any) {
	attrs = append([]any{"reason", reason, "method", r.Method, "path", r.URL.Path, "remote", r.RemoteAddr}, attrs...)
	// Throttle by the reason's category (the text before the first colon),
	// so details like timestamps don't make every rejection "new".
	key, _, _ := strings.Cut(reason, ":")
	slog.Log(r.Context(), a.rejects.level(msg+"|"+key), "auth: "+msg, attrs...)
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(map[string]string{"error": msg, "reason": reason})
}

// probe checks at startup that the signing keys and the issuer's discovery
// document are reachable from the server, and that the issuer matches.
func (a *Authenticator) probe(ctx context.Context) {
	ctx, cancel := context.WithTimeout(ctx, 15*time.Second)
	defer cancel()

	var jwks struct {
		Keys []json.RawMessage `json:"keys"`
	}
	if err := getJSON(ctx, a.jwksURL, &jwks); err != nil {
		slog.Error("auth: cannot fetch OIDC signing keys; every API request will be rejected with 401",
			"jwks_url", a.jwksURL, "err", err, "hint", "check OIDC_JWKS_URL is reachable from this container"+proxyHint(a.jwksURL))
		return
	}
	slog.Info("auth: OIDC signing keys reachable", "jwks_url", a.jwksURL, "keys", len(jwks.Keys))

	// With the compose layout the JWKS URL is the internal address of the
	// same realm, so its discovery document tells us the issuer Keycloak
	// actually puts in tokens.
	base, ok := strings.CutSuffix(a.jwksURL, "/protocol/openid-connect/certs")
	if !ok {
		return
	}
	var disc struct {
		Issuer string `json:"issuer"`
	}
	if err := getJSON(ctx, base+"/.well-known/openid-configuration", &disc); err != nil {
		slog.Debug("auth: issuer discovery skipped", "err", err)
		return
	}
	if disc.Issuer != a.issuer {
		slog.Warn("auth: Keycloak reports a different issuer than OIDC_ISSUER; tokens will likely be rejected",
			"keycloak_issuer", disc.Issuer, "oidc_issuer", a.issuer,
			"hint", "set PUBLIC_KEYCLOAK_URL (compose) or OIDC_ISSUER / KC_HOSTNAME so they match the URL the browser uses")
	}
}

func getJSON(ctx context.Context, url string, v any) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return err
	}
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		return err
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		return fmt.Errorf("%s returned %s", url, res.Status)
	}
	if err := json.NewDecoder(res.Body).Decode(v); err != nil {
		return fmt.Errorf("%s did not return JSON (a proxy or login page in between?): %w", url, err)
	}
	return nil
}
