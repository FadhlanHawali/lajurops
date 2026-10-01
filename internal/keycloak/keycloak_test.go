package keycloak

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
)

// fakeKeycloak implements just enough of the token and admin endpoints.
func fakeKeycloak(t *testing.T) (*httptest.Server, *int) {
	tokens := 0
	mux := http.NewServeMux()
	mux.HandleFunc("POST /realms/r/protocol/openid-connect/token", func(w http.ResponseWriter, r *http.Request) {
		r.ParseForm()
		if r.Form.Get("client_secret") != "s3cret" || r.Form.Get("grant_type") != "client_credentials" {
			w.WriteHeader(http.StatusUnauthorized)
			w.Write([]byte(`{"error":"unauthorized_client","error_description":"Invalid client secret"}`))
			return
		}
		tokens++
		json.NewEncoder(w).Encode(map[string]any{"access_token": "tok", "expires_in": 300})
	})
	auth := func(h http.HandlerFunc) http.HandlerFunc {
		return func(w http.ResponseWriter, r *http.Request) {
			if r.Header.Get("Authorization") != "Bearer tok" {
				w.WriteHeader(http.StatusUnauthorized)
				return
			}
			h(w, r)
		}
	}
	mux.HandleFunc("POST /admin/realms/r/users", auth(func(w http.ResponseWriter, r *http.Request) {
		var body struct {
			Username    string `json:"username"`
			Credentials []credential
		}
		json.NewDecoder(r.Body).Decode(&body)
		if body.Username == "taken" {
			w.WriteHeader(http.StatusConflict)
			w.Write([]byte(`{"errorMessage":"User exists with same username"}`))
			return
		}
		if len(body.Credentials) != 1 || !body.Credentials[0].Temporary {
			t.Errorf("expected one temporary credential, got %+v", body.Credentials)
		}
		w.Header().Set("Location", "http://kc/admin/realms/r/users/new-id")
		w.WriteHeader(http.StatusCreated)
	}))
	mux.HandleFunc("GET /admin/realms/r/roles/lajurops-admin", auth(func(w http.ResponseWriter, r *http.Request) {
		json.NewEncoder(w).Encode(Role{ID: "role-id", Name: "lajurops-admin"})
	}))
	mux.HandleFunc("GET /admin/realms/r/roles/lajurops-admin/users", auth(func(w http.ResponseWriter, r *http.Request) {
		json.NewEncoder(w).Encode([]User{{ID: "a1"}, {ID: "a2"}})
	}))
	mux.HandleFunc("DELETE /admin/realms/r/users/{id}/role-mappings/realm", auth(func(w http.ResponseWriter, r *http.Request) {
		var roles []Role
		json.NewDecoder(r.Body).Decode(&roles)
		if len(roles) != 1 || roles[0].ID != "role-id" || r.PathValue("id") != "u1" {
			t.Errorf("unexpected role removal: %s %+v", r.PathValue("id"), roles)
		}
		w.WriteHeader(http.StatusNoContent)
	}))
	srv := httptest.NewServer(mux)
	t.Cleanup(srv.Close)
	return srv, &tokens
}

func TestClient(t *testing.T) {
	srv, tokens := fakeKeycloak(t)
	ctx := context.Background()
	c := New(srv.URL, "r", "admin-client", "s3cret", http.DefaultClient)

	id, err := c.CreateUser(ctx, User{Username: "jdoe", Enabled: true}, "password1", true)
	if err != nil || id != "new-id" {
		t.Fatalf("CreateUser = %q, %v", id, err)
	}

	_, err = c.CreateUser(ctx, User{Username: "taken"}, "password1", true)
	var ke *Error
	if !errors.As(err, &ke) || ke.Status != http.StatusConflict || ke.Message != "User exists with same username" {
		t.Fatalf("expected conflict error, got %v", err)
	}

	admins, err := c.RoleMemberIDs(ctx, "lajurops-admin")
	if err != nil || !admins["a1"] || !admins["a2"] || len(admins) != 2 {
		t.Fatalf("RoleMemberIDs = %v, %v", admins, err)
	}

	if err := c.SetRealmRole(ctx, "u1", "lajurops-admin", false); err != nil {
		t.Fatalf("SetRealmRole: %v", err)
	}

	if *tokens != 1 {
		t.Errorf("service account token fetched %d times, want 1 (cached)", *tokens)
	}
}

func TestBadSecret(t *testing.T) {
	srv, _ := fakeKeycloak(t)
	_, err := New(srv.URL, "r", "admin-client", "wrong", http.DefaultClient).ListUsers(context.Background(), "", 0, 10)
	var ke *Error
	if !errors.As(err, &ke) || ke.Status != http.StatusUnauthorized || ke.Message != "Invalid client secret" {
		t.Fatalf("expected unauthorized error, got %v", err)
	}
}
