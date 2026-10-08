package store

import (
	"context"
	"fmt"
	"testing"
	"time"
)

func TestSearch(t *testing.T) {
	st, pool := testStore(t)
	ctx := context.Background()
	suffix := fmt.Sprint(time.Now().UnixNano())
	key, other := "SR"+suffix[len(suffix)-5:], "SX"+suffix[len(suffix)-5:]
	ws, err := st.CreateWorkspace(ctx, WorkspaceInput{Key: key, Name: "search"}, "")
	if err != nil {
		t.Fatal(err)
	}
	ws2, _ := st.CreateWorkspace(ctx, WorkspaceInput{Key: other, Name: "hidden"}, "")
	t.Cleanup(func() { pool.Exec(ctx, `DELETE FROM workspaces WHERE key = ANY($1)`, []string{key, other}) })
	bob, _ := st.UpsertUser(ctx, "itest-sr-bob-"+suffix, "bob"+suffix, "", "Bob Builder")
	alice, _ := st.UpsertUser(ctx, "itest-sr-alice-"+suffix, "alice"+suffix, "", "Alice")
	t.Cleanup(func() { pool.Exec(ctx, `DELETE FROM users WHERE id = ANY($1::uuid[])`, []string{bob.ID, alice.ID}) })

	zone := time.FixedZone("WIB", 7*3600)
	now := time.Date(2026, 10, 8, 12, 0, 0, 0, zone) // Thursday; the week is Oct 5-11
	day := func(d int) *time.Time { v := time.Date(2026, 10, d, 0, 0, 0, 0, zone); return &v }
	at := func(d, h int) *time.Time { v := time.Date(2026, 10, d, h, 0, 0, 0, zone); return &v }
	mk := func(in TaskInput) Task {
		t.Helper()
		if in.WorkspaceID == "" {
			in.WorkspaceID = ws.ID
		}
		task, err := st.CreateTask(ctx, in, "")
		if err != nil {
			t.Fatalf("%s: %v", in.Title, err)
		}
		return task
	}
	billing := mk(TaskInput{Title: "Billing v3", Type: "project"})
	envs, err := st.SetEnvironments(ctx, billing.ID, []EnvironmentInput{{Name: "Dev", Color: "green"}, {Name: "Production", Color: "red"}})
	if err != nil {
		t.Fatal(err)
	}
	prep := mk(TaskInput{Title: "Release prep", Type: "daily", ParentID: &billing.ID, StartAt: day(7), EndAt: day(10)})
	deploy := mk(TaskInput{Title: "Deploy to Production", Type: "hourly", ParentID: &prep.ID, EnvironmentID: &envs[1].ID,
		AssigneeIDs: []string{bob.ID}, StartAt: at(8, 20), EndAt: at(8, 21)})
	oldDeploy := mk(TaskInput{Title: "Deploy to Production", Type: "hourly", ParentID: &prep.ID, EnvironmentID: &envs[1].ID,
		AssigneeIDs: []string{bob.ID}, Status: "done", StartAt: at(1, 20), EndAt: at(1, 21)})
	devDeploy := mk(TaskInput{Title: "Deploy to Dev", Type: "hourly", ParentID: &prep.ID, EnvironmentID: &envs[0].ID,
		AssigneeIDs: []string{alice.ID}, StartAt: at(8, 9), EndAt: at(8, 10)})
	notes := mk(TaskInput{Title: "Prepare release notes", Type: "daily", AssigneeIDs: []string{alice.ID}, StartAt: day(12), EndAt: day(14)})
	mk(TaskInput{Title: "Release prep elsewhere", Type: "daily", WorkspaceID: ws2.ID})

	scope := []string{ws.ID}
	search := func(q string) SearchResults {
		t.Helper()
		res, err := st.Search(ctx, SearchQuery{Text: q, Me: alice.ID, TZ: "Asia/Jakarta", WorkspaceIDs: scope, Now: now})
		if err != nil {
			t.Fatalf("%q: %v", q, err)
		}
		return res
	}
	ids := func(r SearchResults) []string {
		out := []string{}
		for _, x := range r.Results {
			out = append(out, x.Title+"/"+x.Key)
		}
		return out
	}
	has := func(r SearchResults, want ...Task) bool {
		if len(r.Results) != len(want) {
			return false
		}
		got := map[string]bool{}
		for _, x := range r.Results {
			got[x.ID] = true
		}
		for _, w := range want {
			if !got[w.ID] {
				return false
			}
		}
		return true
	}

	// Words match titles (any order, any case); only visible workspaces.
	if r := search("RELEASE"); !has(r, prep, notes) {
		t.Errorf("release = %v", ids(r))
	}
	// Typos still match (pg_trgm), but not unrelated words.
	if st.hasTrgm(ctx) {
		if r := search("relase"); !has(r, prep, notes) {
			t.Errorf("relase (typo) = %v", ids(r))
		}
		if r := search("deplyo"); !has(r, deploy, oldDeploy, devDeploy) {
			t.Errorf("deplyo (typo) = %v", ids(r))
		}
		if r := search("develop"); !has(r) {
			t.Errorf("develop = %v, want nothing", ids(r))
		}
	}
	r := search("deploy production")
	if len(r.Results) != 2 || r.Results[0].ID != deploy.ID || r.Results[1].ID != oldDeploy.ID {
		t.Fatalf("open before done = %v", ids(r))
	}
	if p := r.Results[0].Path; fmt.Sprint(p) != "[Billing v3 Release prep]" || *r.Results[0].EnvironmentName != "Production" {
		t.Errorf("path = %v, env %v", p, r.Results[0].EnvironmentName)
	}
	// A key goes first.
	if r := search(fmt.Sprintf("%s-%d", key, devDeploy.Number)); len(r.Results) == 0 || r.Results[0].ID != devDeploy.ID {
		t.Errorf("key = %v", ids(r))
	}

	// Filters, alone or with words.
	cases := map[string][]Task{
		"@bob":                     {deploy, oldDeploy},
		"@builder":                 {deploy, oldDeploy}, // display name, any word
		"@me deploy":               {devDeploy},
		"deploy #prod":             {deploy, oldDeploy},
		"deploy #prod is:open":     {deploy},
		"is:done":                  {oldDeploy},
		"type:daily":               {prep, notes},
		"in:billing type:daily":    {prep},
		"deploy due:this-week":     {deploy, devDeploy},
		"due:next-week":            {notes},
		"deploy due:last-week":     {oldDeploy}, // Oct 1; last week is Sep 28 - Oct 4
		"deploy due:oct #dev":      {devDeploy},
		"deploy due:2026-10-01":    {oldDeploy},
		"in:billing @bob is:open":  {deploy},
		"prepare in:nothing-there": {},
	}
	for q, want := range cases {
		if r := search(q); !has(r, want...) {
			t.Errorf("%q = %v, want %d results", q, ids(r), len(want))
		}
	}
	if r := search("deploy #prod due:this-week"); fmt.Sprint(r.Filters) != "[{env prod} {due this week}]" {
		t.Errorf("filters = %+v", r.Filters)
	}
	if r := search("deploy due:soon is:maybe type:epic"); fmt.Sprint(r.Unknown) != "[due:soon is:maybe type:epic]" || len(r.Results) != 3 {
		t.Errorf("unknown filters = %v, results %v", r.Unknown, ids(r))
	}
	if r := search("   "); len(r.Results) != 0 {
		t.Errorf("empty query = %v", ids(r))
	}
	// LIKE wildcards are plain text.
	if r := search("%"); len(r.Results) != 0 {
		t.Errorf("%% = %v", ids(r))
	}
	// Nothing outside the caller's workspaces; nil scope means all.
	if r, _ := st.Search(ctx, SearchQuery{Text: "release prep", WorkspaceIDs: []string{}, Now: now}); len(r.Results) != 0 {
		t.Errorf("no workspaces = %v", ids(r))
	}

	// Recently opened tasks come back in the given order, within scope.
	list, err := st.SearchByIDs(ctx, []string{notes.ID, "no-such-id", deploy.ID}, scope)
	if err != nil || len(list) != 2 || list[0].ID != notes.ID || list[1].ID != deploy.ID {
		t.Errorf("by ids = %+v, %v", list, err)
	}
}
