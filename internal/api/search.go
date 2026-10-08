package api

import (
	"net/http"

	"github.com/FadhlanHawali/lajurops/internal/auth"
	"github.com/FadhlanHawali/lajurops/internal/store"
)

// search powers the Ctrl+K palette: ?q=<words and filters>&tz=<IANA zone>
// searches the workspaces the caller can see; ?ids=a,b,c instead returns
// those tasks in order (the caller's recently opened ones).
func (a *API) search(w http.ResponseWriter, r *http.Request) {
	visible, err := a.visible(r)
	if err != nil {
		respond(w, nil, err)
		return
	}
	q := r.URL.Query()
	if ids := splitList(q.Get("ids")); ids != nil {
		if len(ids) > 50 {
			ids = ids[:50]
		}
		list, err := a.store.SearchByIDs(r.Context(), ids, visible)
		respond(w, store.SearchResults{Results: list, Filters: []store.SearchFilter{}, Unknown: []string{}}, err)
		return
	}
	res, err := a.store.Search(r.Context(), store.SearchQuery{
		Text:         q.Get("q"),
		Me:           auth.From(r.Context()).ID,
		TZ:           q.Get("tz"),
		WorkspaceIDs: visible,
	})
	respond(w, res, err)
}
