package web

import "testing"

func TestAppRoute(t *testing.T) {
	for path, want := range map[string]bool{
		"": true, "calendar": true, "reports": true, "commitments": true, "admin/users": true,
		"w/abc": true, "w/abc/board": true, "w/abc/timeline": true, "w/abc/anything": true, // the app corrects unknown views
		"w": false, "w/": false, "w/abc/board/extra": false, "boards": false, "admin": false, "random/page": false, "api-docs": false,
	} {
		if got := AppRoute(path); got != want {
			t.Errorf("AppRoute(%q) = %v, want %v", path, got, want)
		}
	}
}
