package api

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"strings"
	"syscall"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/FadhlanHawali/lajurops/internal/auth"
	"github.com/FadhlanHawali/lajurops/internal/store"
)

// Backups can be large; allow more than the default JSON body limit.
const maxBackupBytes = 25 << 20

func (a *API) exportWorkspace(w http.ResponseWriter, r *http.Request) {
	if !a.require(w, r, chi.URLParam(r, "id"), levelViewer) {
		return
	}
	doc, err := a.store.ExportWorkspaceData(r.Context(), chi.URLParam(r, "id"), auth.UserFrom(r.Context()).Username)
	if err != nil {
		respond(w, nil, err)
		return
	}
	name := fmt.Sprintf("%s-%s.json", doc.Workspace.Key, doc.ExportedAt.Format("2006-01-02"))
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Content-Disposition", `attachment; filename="`+name+`"`)
	enc := json.NewEncoder(w)
	enc.SetIndent("", "  ")
	enc.Encode(doc)
}

// importWorkspace restores a backup (the request body) as a new workspace.
// ?dry_run=true validates and returns what would be imported.
func (a *API) importWorkspace(w http.ResponseWriter, r *http.Request) {
	if !a.requireCreate(w, r) {
		return
	}
	var doc store.ExportDoc
	dec := json.NewDecoder(http.MaxBytesReader(w, r.Body, maxBackupBytes))
	if err := dec.Decode(&doc); err != nil {
		respond(w, nil, store.InvalidError{Msg: "could not read the backup: " + err.Error()})
		return
	}
	q := r.URL.Query()
	res, err := a.store.ImportWorkspaceData(r.Context(), doc, store.ImportOptions{
		Key:        q.Get("key"),
		Name:       q.Get("name"),
		ImporterID: auth.UserFrom(r.Context()).ID,
		DryRun:     q.Get("dry_run") == "true",
	})
	status := http.StatusCreated
	if res.DryRun {
		status = http.StatusOK
	} else if err == nil && res.Workspace != nil {
		err = a.joinAsEditor(r, res.Workspace.ID)
	}
	respondStatus(w, status, res, err)
}

// fetchBackup downloads a backup from a URL on the server side (browsers are
// usually blocked by CORS) and returns it for preview and import.
func (a *API) fetchBackup(w http.ResponseWriter, r *http.Request) {
	// Only people who may import can make the server fetch URLs.
	if !a.requireCreate(w, r) {
		return
	}
	var in struct {
		URL string `json:"url"`
	}
	if err := decode(r, &in); err != nil {
		respond(w, nil, err)
		return
	}
	u, err := url.Parse(strings.TrimSpace(in.URL))
	if err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Host == "" {
		respond(w, nil, store.InvalidError{Msg: "enter an http(s) URL"})
		return
	}
	req, err := http.NewRequestWithContext(r.Context(), http.MethodGet, u.String(), nil)
	if err != nil {
		respond(w, nil, store.InvalidError{Msg: "invalid URL"})
		return
	}
	req.Header.Set("Accept", "application/json")
	res, err := backupClient(a.cfg.ImportAllowPrivateURLs).Do(req)
	if err != nil {
		msg := "could not download the backup: " + err.Error()
		if errors.Is(err, errPrivateAddress) {
			msg = "this URL points to a private or internal address, which is blocked (set IMPORT_ALLOW_PRIVATE_URLS=true to allow it)"
		}
		respond(w, nil, store.InvalidError{Msg: msg})
		return
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		respond(w, nil, store.InvalidError{Msg: fmt.Sprintf("the URL returned HTTP %d", res.StatusCode)})
		return
	}
	body, err := io.ReadAll(io.LimitReader(res.Body, maxBackupBytes+1))
	if err != nil {
		respond(w, nil, store.InvalidError{Msg: "could not download the backup: " + err.Error()})
		return
	}
	if len(body) > maxBackupBytes {
		respond(w, nil, store.InvalidError{Msg: "the backup is larger than 25 MB"})
		return
	}
	var doc store.ExportDoc
	if err := json.Unmarshal(body, &doc); err != nil || !store.IsBackupFormat(doc.Format) {
		respond(w, nil, store.InvalidError{Msg: "the URL did not return a LajurOps workspace backup"})
		return
	}
	writeJSON(w, http.StatusOK, doc)
}

var errPrivateAddress = errors.New("private address")

// backupClient refuses to connect to loopback, private, link-local (cloud
// metadata) and other internal addresses unless allowPrivate is set. The
// check runs on the resolved IP at connect time, so DNS tricks and
// redirects can't bypass it.
func backupClient(allowPrivate bool) *http.Client {
	dialer := &net.Dialer{
		Timeout: 10 * time.Second,
		Control: func(_, address string, _ syscall.RawConn) error {
			if allowPrivate {
				return nil
			}
			host, _, err := net.SplitHostPort(address)
			if err != nil {
				return err
			}
			ip := net.ParseIP(host)
			if ip == nil || ip.IsLoopback() || ip.IsPrivate() || ip.IsLinkLocalUnicast() || ip.IsLinkLocalMulticast() ||
				ip.IsUnspecified() || ip.IsMulticast() || isSharedAddress(ip) {
				return errPrivateAddress
			}
			return nil
		},
	}
	return &http.Client{
		Timeout: 60 * time.Second,
		Transport: &http.Transport{
			Proxy:                 nil,
			DialContext:           dialer.DialContext,
			TLSHandshakeTimeout:   10 * time.Second,
			ResponseHeaderTimeout: 20 * time.Second,
		},
		CheckRedirect: func(req *http.Request, via []*http.Request) error {
			if len(via) >= 3 {
				return errors.New("too many redirects")
			}
			if req.URL.Scheme != "http" && req.URL.Scheme != "https" {
				return errors.New("redirect to a non-http URL")
			}
			return nil
		},
	}
}

// isSharedAddress reports carrier-grade NAT space (100.64.0.0/10).
func isSharedAddress(ip net.IP) bool {
	v4 := ip.To4()
	return v4 != nil && v4[0] == 100 && v4[1]&0xC0 == 64
}
