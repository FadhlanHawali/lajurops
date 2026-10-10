package api

import (
	"context"
	"net/http"

	"github.com/FadhlanHawali/lajurops/internal/auth"
	"github.com/FadhlanHawali/lajurops/internal/store"
)

// Notifications (the bell) are the caller's own; nobody else's can be read.

// canSee reports whether a user (not necessarily the caller) can see a
// workspace, for deciding who an @mention reaches.
func (a *API) canSee(ctx context.Context, userID, workspaceID string) bool {
	if a.store.UserIsAdmin(ctx, userID) {
		return true
	}
	roles, err := a.store.WorkspaceRoles(ctx, userID, a.cfg.DefaultWorkspaceRole)
	return err == nil && levelOf(roles[workspaceID]) >= levelViewer
}

// listNotifications returns the caller's notifications and unread count;
// ?tz= records their time zone for reminders at local times.
func (a *API) listNotifications(w http.ResponseWriter, r *http.Request) {
	visible, err := a.visible(r)
	if err != nil {
		respond(w, nil, err)
		return
	}
	me := auth.From(r.Context()).ID
	a.store.RememberTimeZone(r.Context(), me, r.URL.Query().Get("tz"))
	items, unread, err := a.store.Notifications(r.Context(), me, visible, 100)
	respond(w, map[string]any{"items": items, "unread": unread}, err)
}

// notificationCount is the bell's badge (polled).
func (a *API) notificationCount(w http.ResponseWriter, r *http.Request) {
	visible, err := a.visible(r)
	if err != nil {
		respond(w, nil, err)
		return
	}
	n, err := a.store.UnreadNotifications(r.Context(), auth.From(r.Context()).ID, visible)
	respond(w, map[string]int{"unread": n}, err)
}

// markNotificationsRead marks { ids: [...] } read, or all of them with { all: true }.
func (a *API) markNotificationsRead(w http.ResponseWriter, r *http.Request) {
	var in struct {
		IDs []string `json:"ids"`
		All bool     `json:"all"`
	}
	if err := decode(r, &in); err != nil {
		respond(w, nil, err)
		return
	}
	if !in.All && len(in.IDs) == 0 {
		respond(w, nil, store.InvalidError{Msg: "give ids or all"})
		return
	}
	ids := in.IDs
	if in.All {
		ids = nil
	}
	err := a.store.MarkNotificationsRead(r.Context(), auth.From(r.Context()).ID, ids)
	respond(w, map[string]bool{"ok": true}, err)
}

func (a *API) getNotificationSettings(w http.ResponseWriter, r *http.Request) {
	ns, err := a.store.GetNotificationSettings(r.Context(), auth.From(r.Context()).ID)
	respond(w, ns, err)
}

func (a *API) saveNotificationSettings(w http.ResponseWriter, r *http.Request) {
	var in store.NotificationSettings
	if err := decode(r, &in); err != nil {
		respond(w, nil, err)
		return
	}
	me := auth.From(r.Context()).ID
	if err := a.store.SaveNotificationSettings(r.Context(), me, in); err != nil {
		respond(w, nil, err)
		return
	}
	ns, err := a.store.GetNotificationSettings(r.Context(), me)
	respond(w, ns, err)
}
