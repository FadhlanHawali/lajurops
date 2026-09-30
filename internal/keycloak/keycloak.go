// Package keycloak is a small client for the Keycloak Admin REST API,
// authenticated as a confidential client's service account.
package keycloak

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"path"
	"strconv"
	"strings"
	"sync"
	"time"
)

type Client struct {
	baseURL, realm         string
	clientID, clientSecret string
	hc                     *http.Client

	mu     sync.Mutex
	token  string
	expiry time.Time
}

func New(baseURL, realm, clientID, clientSecret string) *Client {
	return &Client{
		baseURL:      strings.TrimRight(baseURL, "/"),
		realm:        realm,
		clientID:     clientID,
		clientSecret: clientSecret,
		hc:           &http.Client{Timeout: 15 * time.Second},
	}
}

// Error is a non-2xx response from Keycloak.
type Error struct {
	Status  int
	Message string
}

func (e *Error) Error() string { return fmt.Sprintf("keycloak: %d %s", e.Status, e.Message) }

type User struct {
	ID               string   `json:"id,omitempty"`
	Username         string   `json:"username,omitempty"`
	Email            string   `json:"email"`
	FirstName        string   `json:"firstName"`
	LastName         string   `json:"lastName"`
	Enabled          bool     `json:"enabled"`
	EmailVerified    bool     `json:"emailVerified"`
	CreatedTimestamp int64    `json:"createdTimestamp,omitempty"`
	RequiredActions  []string `json:"requiredActions,omitempty"`
}

// DisplayName joins first and last name.
func (u User) DisplayName() string {
	return strings.TrimSpace(u.FirstName + " " + u.LastName)
}

type Role struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}

type credential struct {
	Type      string `json:"type"`
	Value     string `json:"value"`
	Temporary bool   `json:"temporary"`
}

func (c *Client) accessToken(ctx context.Context) (string, error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.token != "" && time.Now().Before(c.expiry) {
		return c.token, nil
	}
	form := url.Values{
		"grant_type":    {"client_credentials"},
		"client_id":     {c.clientID},
		"client_secret": {c.clientSecret},
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost,
		c.baseURL+"/realms/"+url.PathEscape(c.realm)+"/protocol/openid-connect/token", strings.NewReader(form.Encode()))
	if err != nil {
		return "", err
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	res, err := c.hc.Do(req)
	if err != nil {
		return "", fmt.Errorf("keycloak token: %w", err)
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		return "", readError(res)
	}
	var tok struct {
		AccessToken string `json:"access_token"`
		ExpiresIn   int    `json:"expires_in"`
	}
	if err := json.NewDecoder(res.Body).Decode(&tok); err != nil {
		return "", err
	}
	c.token = tok.AccessToken
	c.expiry = time.Now().Add(time.Duration(tok.ExpiresIn)*time.Second - 30*time.Second)
	return c.token, nil
}

// do calls {base}/admin/realms/{realm}/{p}, encoding in as JSON and decoding into out.
func (c *Client) do(ctx context.Context, method, p string, query url.Values, in, out any) (*http.Response, error) {
	token, err := c.accessToken(ctx)
	if err != nil {
		return nil, err
	}
	u := c.baseURL + path.Join("/admin/realms", url.PathEscape(c.realm), p)
	if len(query) > 0 {
		u += "?" + query.Encode()
	}
	var body io.Reader
	if in != nil {
		b, err := json.Marshal(in)
		if err != nil {
			return nil, err
		}
		body = bytes.NewReader(b)
	}
	req, err := http.NewRequestWithContext(ctx, method, u, body)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+token)
	if in != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	res, err := c.hc.Do(req)
	if err != nil {
		return nil, fmt.Errorf("keycloak: %w", err)
	}
	defer res.Body.Close()
	if res.StatusCode >= 300 {
		return res, readError(res)
	}
	if out != nil {
		if err := json.NewDecoder(res.Body).Decode(out); err != nil {
			return res, err
		}
	}
	return res, nil
}

func readError(res *http.Response) error {
	b, _ := io.ReadAll(io.LimitReader(res.Body, 4096))
	var e struct {
		ErrorMessage     string `json:"errorMessage"`
		Error            string `json:"error"`
		ErrorDescription string `json:"error_description"`
	}
	msg := strings.TrimSpace(string(b))
	if json.Unmarshal(b, &e) == nil {
		switch {
		case e.ErrorMessage != "":
			msg = e.ErrorMessage
		case e.ErrorDescription != "":
			msg = e.ErrorDescription
		case e.Error != "":
			msg = e.Error
		}
	}
	return &Error{Status: res.StatusCode, Message: msg}
}

func (c *Client) ListUsers(ctx context.Context, search string, first, max int) ([]User, error) {
	q := url.Values{"first": {strconv.Itoa(first)}, "max": {strconv.Itoa(max)}, "briefRepresentation": {"false"}}
	if search != "" {
		q.Set("search", search)
	}
	users := []User{}
	_, err := c.do(ctx, http.MethodGet, "users", q, nil, &users)
	return users, err
}

func (c *Client) CountUsers(ctx context.Context, search string) (int, error) {
	q := url.Values{}
	if search != "" {
		q.Set("search", search)
	}
	var n int
	_, err := c.do(ctx, http.MethodGet, "users/count", q, nil, &n)
	return n, err
}

func (c *Client) GetUser(ctx context.Context, id string) (User, error) {
	var u User
	_, err := c.do(ctx, http.MethodGet, "users/"+url.PathEscape(id), nil, nil, &u)
	return u, err
}

// CreateUser creates a user with an initial password and returns its id.
func (c *Client) CreateUser(ctx context.Context, u User, password string, temporary bool) (string, error) {
	body := struct {
		User
		Credentials []credential `json:"credentials,omitempty"`
	}{User: u}
	if password != "" {
		body.Credentials = []credential{{Type: "password", Value: password, Temporary: temporary}}
	}
	res, err := c.do(ctx, http.MethodPost, "users", nil, body, nil)
	if err != nil {
		return "", err
	}
	loc := res.Header.Get("Location")
	return loc[strings.LastIndex(loc, "/")+1:], nil
}

func (c *Client) UpdateUser(ctx context.Context, u User) error {
	_, err := c.do(ctx, http.MethodPut, "users/"+url.PathEscape(u.ID), nil, u, nil)
	return err
}

func (c *Client) ResetPassword(ctx context.Context, id, password string, temporary bool) error {
	_, err := c.do(ctx, http.MethodPut, "users/"+url.PathEscape(id)+"/reset-password", nil,
		credential{Type: "password", Value: password, Temporary: temporary}, nil)
	return err
}

func (c *Client) DeleteUser(ctx context.Context, id string) error {
	_, err := c.do(ctx, http.MethodDelete, "users/"+url.PathEscape(id), nil, nil, nil)
	return err
}

func (c *Client) RealmRole(ctx context.Context, name string) (Role, error) {
	var r Role
	_, err := c.do(ctx, http.MethodGet, "roles/"+url.PathEscape(name), nil, nil, &r)
	return r, err
}

// RoleMemberIDs returns the ids of users directly holding a realm role.
func (c *Client) RoleMemberIDs(ctx context.Context, role string) (map[string]bool, error) {
	var users []User
	q := url.Values{"first": {"0"}, "max": {"10000"}, "briefRepresentation": {"true"}}
	if _, err := c.do(ctx, http.MethodGet, "roles/"+url.PathEscape(role)+"/users", q, nil, &users); err != nil {
		return nil, err
	}
	ids := make(map[string]bool, len(users))
	for _, u := range users {
		ids[u.ID] = true
	}
	return ids, nil
}

// SetRealmRole grants or revokes a realm role for a user.
func (c *Client) SetRealmRole(ctx context.Context, userID, role string, grant bool) error {
	r, err := c.RealmRole(ctx, role)
	if err != nil {
		return err
	}
	method := http.MethodPost
	if !grant {
		method = http.MethodDelete
	}
	_, err = c.do(ctx, method, "users/"+url.PathEscape(userID)+"/role-mappings/realm", nil, []Role{r}, nil)
	return err
}
