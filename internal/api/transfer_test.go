package api

import (
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestBackupClientBlocksPrivateAddresses(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { w.Write([]byte("{}")) }))
	defer srv.Close() // listens on 127.0.0.1

	if _, err := backupClient(false).Get(srv.URL); !errors.Is(err, errPrivateAddress) {
		t.Fatalf("expected loopback to be blocked, got %v", err)
	}
	res, err := backupClient(true).Get(srv.URL)
	if err != nil {
		t.Fatalf("allowPrivate should permit loopback: %v", err)
	}
	res.Body.Close()
}
