// Package web embeds the built frontend (web/dist, produced by `npm run build`)
// so the Go binary serves the whole application.
package web

import (
	"embed"
	"io/fs"
	"net/http"
	"path"
	"strings"
)

//go:embed all:dist
var dist embed.FS

// Handler serves static assets and falls back to index.html for client-side routes.
func Handler() http.Handler {
	root, _ := fs.Sub(dist, "dist")
	files := http.FileServer(http.FS(root))

	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		name := strings.TrimPrefix(path.Clean(r.URL.Path), "/")
		if name != "" {
			if f, err := root.Open(name); err == nil {
				f.Close()
				if strings.HasPrefix(name, "assets/") {
					// Vite fingerprints everything under assets/.
					w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
				}
				files.ServeHTTP(w, r)
				return
			}
		}

		index, err := fs.ReadFile(root, "index.html")
		if err != nil {
			http.Error(w, "frontend not built: run `make build` (or `npm run build` in web/)", http.StatusNotFound)
			return
		}
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		w.Header().Set("Cache-Control", "no-cache")
		// The app shows its own "Page not found"; the status says so too, for
		// proxies, monitoring and link checkers.
		if !AppRoute(name) {
			w.WriteHeader(http.StatusNotFound)
		}
		w.Write(index)
	})
}

// AppRoute reports whether a path (without the leading slash) is one of the
// frontend's pages (see the routes in web/src/App.tsx).
func AppRoute(name string) bool {
	switch name {
	case "", "calendar", "reports", "commitments", "admin/users", "index.html":
		return true
	}
	parts := strings.Split(name, "/")
	// /w/<workspace> and /w/<workspace>/<view>
	return parts[0] == "w" && (len(parts) == 2 || len(parts) == 3) && parts[1] != ""
}
