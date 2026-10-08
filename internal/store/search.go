package store

import (
	"context"
	"fmt"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/jackc/pgx/v5"
)

// Search (Ctrl+K): tasks found by key or title, with filters typed inline:
// @person, #environment, is:open|done, type:project|daily|hourly,
// in:<project>, due:<period>. Titles match by substring and, when pg_trgm
// is available, by similar words (typos).

// SearchResult is a task as the search palette shows it: where it lives
// (Path: the titles of its project and daily parent, outermost first) and
// its state.
type SearchResult struct {
	ID               string     `json:"id"`
	WorkspaceID      string     `json:"workspace_id"`
	WorkspaceKey     string     `json:"workspace_key"`
	Key              string     `json:"key"`
	Title            string     `json:"title"`
	Type             string     `json:"type"`
	Status           string     `json:"status"`
	Path             []string   `json:"path"`
	EnvironmentName  *string    `json:"environment_name"`
	EnvironmentColor *string    `json:"environment_color"`
	CategoryName     *string    `json:"category_name"`
	CategoryColor    *string    `json:"category_color"`
	StartAt          *time.Time `json:"start_at"`
	EndAt            *time.Time `json:"end_at"`
	AssigneeIDs      []string   `json:"assignee_ids"`
}

// SearchFilter is a filter understood from the query, for showing as a chip.
type SearchFilter struct {
	Kind  string `json:"kind"` // owner, env, is, type, in, due
	Label string `json:"label"`
}

type SearchResults struct {
	Results []SearchResult `json:"results"`
	Filters []SearchFilter `json:"filters"`
	// Unknown lists tokens that look like filters but aren't (e.g. "due:soon").
	Unknown []string `json:"unknown"`
	// More is set when there are more matches than were returned.
	More bool `json:"more"`
}

// SearchQuery is one search. WorkspaceIDs limits it (nil means all); Me
// resolves "@me"; TZ places due: periods in the user's time zone.
type SearchQuery struct {
	Text         string
	Me           string
	TZ           string
	WorkspaceIDs []string
	Limit        int
	Now          time.Time
}

type parsedSearch struct {
	words        []string
	owner, me    string
	env, is, typ string
	in           string
	from, to     *time.Time
	keyNum       int
	keyPrefix    string
	filters      []SearchFilter
	unknown      []string
}

var months = map[string]time.Month{}

func init() {
	for m := time.January; m <= time.December; m++ {
		full := strings.ToLower(m.String())
		months[full] = m
		months[full[:3]] = m
	}
}

// period turns a due: value into a [from, to) range in loc.
func period(v string, now time.Time, loc *time.Location) (time.Time, time.Time, string, bool) {
	day := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, loc)
	monday := day.AddDate(0, 0, -((int(day.Weekday()) + 6) % 7))
	month := time.Date(now.Year(), now.Month(), 1, 0, 0, 0, 0, loc)
	switch v {
	case "today":
		return day, day.AddDate(0, 0, 1), "today", true
	case "tomorrow":
		return day.AddDate(0, 0, 1), day.AddDate(0, 0, 2), "tomorrow", true
	case "yesterday":
		return day.AddDate(0, 0, -1), day, "yesterday", true
	case "this-week", "week":
		return monday, monday.AddDate(0, 0, 7), "this week", true
	case "last-week":
		return monday.AddDate(0, 0, -7), monday, "last week", true
	case "next-week":
		return monday.AddDate(0, 0, 7), monday.AddDate(0, 0, 14), "next week", true
	case "this-month", "month":
		return month, month.AddDate(0, 1, 0), "this month", true
	case "last-month":
		return month.AddDate(0, -1, 0), month, "last month", true
	case "next-month":
		return month.AddDate(0, 1, 0), month.AddDate(0, 2, 0), "next month", true
	}
	if m, ok := months[v]; ok {
		start := time.Date(now.Year(), m, 1, 0, 0, 0, 0, loc)
		return start, start.AddDate(0, 1, 0), m.String(), true
	}
	if d, err := time.ParseInLocation(time.DateOnly, v, loc); err == nil {
		return d, d.AddDate(0, 0, 1), d.Format("Jan 2, 2006"), true
	}
	return time.Time{}, time.Time{}, "", false
}

func parseSearch(text string, now time.Time, loc *time.Location) parsedSearch {
	var p parsedSearch
	add := func(kind, label string) { p.filters = append(p.filters, SearchFilter{kind, label}) }
	for _, tok := range strings.Fields(text) {
		low := strings.ToLower(tok)
		name, val, hasColon := strings.Cut(low, ":")
		switch {
		case strings.HasPrefix(low, "@") && len(low) > 1:
			if low == "@me" {
				p.me = "me"
			} else {
				p.owner = low[1:]
			}
			add("owner", low[1:])
		case strings.HasPrefix(low, "#") && len(low) > 1:
			p.env = low[1:]
			add("env", low[1:])
		case hasColon && name == "is":
			if val != "open" && val != "done" {
				p.unknown = append(p.unknown, tok)
				continue
			}
			p.is = val
			add("is", val)
		case hasColon && name == "type":
			if !taskTypes[val] {
				p.unknown = append(p.unknown, tok)
				continue
			}
			p.typ = val
			add("type", val)
		case hasColon && name == "in" && strings.Trim(val, `"'`) != "":
			val = strings.Trim(val, `"'`)
			p.in = val
			add("in", val)
		case hasColon && name == "due":
			from, to, label, ok := period(val, now.In(loc), loc)
			if !ok {
				p.unknown = append(p.unknown, tok)
				continue
			}
			p.from, p.to = &from, &to
			add("due", label)
		default:
			p.words = append(p.words, low)
		}
	}
	// One word like "APP-12" or "12" can be a task key.
	if len(p.words) == 1 {
		if m := taskNumberRe.FindStringSubmatch(p.words[0]); m != nil {
			p.keyNum, _ = strconv.Atoi(m[1])
			if prefix, _, ok := strings.Cut(p.words[0], "-"); ok {
				p.keyPrefix = strings.ToUpper(prefix)
			}
		}
	}
	return p
}

// likeEscape escapes LIKE wildcards in user text.
func likeEscape(s string) string {
	return strings.NewReplacer(`\`, `\\`, `%`, `\%`, `_`, `\_`).Replace(s)
}

var (
	trgmOnce sync.Once
	trgmOK   bool
)

// hasTrgm reports whether pg_trgm is enabled (checked once).
func (s *Store) hasTrgm(ctx context.Context) bool {
	trgmOnce.Do(func() {
		_ = s.db.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_trgm')`).Scan(&trgmOK)
	})
	return trgmOK
}

const searchCols = `t.id::text, t.workspace_id::text, w.key, w.key || '-' || t.number, t.title, t.type, t.status,
	array_remove(ARRAY[p2.title, p1.title], NULL), e.name, e.color, pc.name, pc.color, t.start_at, t.end_at,
	(SELECT coalesce(array_agg(a.user_id::text ORDER BY a.assigned_at), '{}') FROM task_assignees a WHERE a.task_id = t.id)`

const searchFrom = ` FROM tasks t JOIN workspaces w ON w.id = t.workspace_id
	LEFT JOIN tasks p1 ON p1.id = t.parent_id
	LEFT JOIN tasks p2 ON p2.id = p1.parent_id
	LEFT JOIN project_environments e ON e.id = t.environment_id
	LEFT JOIN project_categories pc ON pc.id = t.project_category_id`

type querier interface {
	Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error)
}

func scanResults(ctx context.Context, db querier, q string, args ...any) ([]SearchResult, error) {
	rows, err := db.Query(ctx, q, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []SearchResult{}
	for rows.Next() {
		var r SearchResult
		if err := rows.Scan(&r.ID, &r.WorkspaceID, &r.WorkspaceKey, &r.Key, &r.Title, &r.Type, &r.Status, &r.Path,
			&r.EnvironmentName, &r.EnvironmentColor, &r.CategoryName, &r.CategoryColor, &r.StartAt, &r.EndAt, &r.AssigneeIDs); err != nil {
			return nil, err
		}
		out = append(out, r)
	}
	return out, rows.Err()
}

// Search finds tasks for the palette, best match first: an exact key,
// then titles containing every word, then similar titles; open work before
// done, then the tasks closest to today.
func (s *Store) Search(ctx context.Context, sq SearchQuery) (SearchResults, error) {
	loc, err := loadTZ(sq.TZ)
	if err != nil {
		return SearchResults{}, err
	}
	if sq.Now.IsZero() {
		sq.Now = time.Now()
	}
	if sq.Limit <= 0 {
		sq.Limit = 40
	}
	p := parseSearch(sq.Text, sq.Now, loc)
	res := SearchResults{Results: []SearchResult{}, Filters: p.filters, Unknown: p.unknown}
	if res.Filters == nil {
		res.Filters = []SearchFilter{}
	}
	if res.Unknown == nil {
		res.Unknown = []string{}
	}
	if len(p.words) == 0 && len(p.filters) == 0 {
		return res, nil
	}

	var args []any
	arg := func(v any) string {
		args = append(args, v)
		return "$" + strconv.Itoa(len(args))
	}
	conds := []string{}
	if sq.WorkspaceIDs != nil {
		conds = append(conds, "t.workspace_id::text = ANY("+arg(sq.WorkspaceIDs)+")")
	}

	// Words: each must be in the title (or, with pg_trgm, a similar word).
	trgm := s.hasTrgm(ctx)
	var wordConds, literal []string
	similarity := "0"
	for _, w := range p.words {
		like := arg("%" + likeEscape(w) + "%")
		lit := "lower(t.title) LIKE " + like
		literal = append(literal, lit)
		// Typos are matched in words, not in keys or numbers.
		if trgm && len([]rune(w)) >= 4 && !strings.ContainsAny(w, "0123456789") {
			word := arg(w)
			wordConds = append(wordConds, "("+lit+" OR "+word+" <% lower(t.title))")
			similarity += " + word_similarity(" + word + ", lower(t.title))"
		} else {
			wordConds = append(wordConds, lit)
		}
	}
	keyMatch := "false"
	if p.keyNum > 0 {
		keyMatch = "t.number = " + arg(p.keyNum)
		if p.keyPrefix != "" {
			keyMatch += " AND w.key = " + arg(p.keyPrefix)
		}
		keyMatch = "(" + keyMatch + ")"
	}
	if len(wordConds) > 0 {
		conds = append(conds, "("+keyMatch+" OR ("+strings.Join(wordConds, " AND ")+"))")
	}
	allLiteral := "true"
	if len(literal) > 0 {
		allLiteral = strings.Join(literal, " AND ")
	}

	// Filters.
	switch {
	case p.me != "":
		conds = append(conds, "EXISTS (SELECT 1 FROM task_assignees a WHERE a.task_id = t.id AND a.user_id::text = "+arg(sq.Me)+")")
	case p.owner != "":
		o := arg(likeEscape(p.owner) + "%")
		conds = append(conds, `EXISTS (SELECT 1 FROM task_assignees a JOIN users u ON u.id = a.user_id WHERE a.task_id = t.id
			AND (lower(u.username) LIKE `+o+` OR lower(u.display_name) LIKE `+o+` OR lower(u.display_name) LIKE '% ' || `+o+`))`)
	}
	if p.env != "" {
		conds = append(conds, "lower(e.name) LIKE "+arg(likeEscape(p.env)+"%"))
	}
	switch p.is {
	case "open":
		conds = append(conds, "t.status <> 'done'")
	case "done":
		conds = append(conds, "t.status = 'done'")
	}
	if p.typ != "" {
		conds = append(conds, "t.type = "+arg(p.typ))
	}
	if p.in != "" {
		in := arg("%" + likeEscape(p.in) + "%")
		conds = append(conds, "((p1.type = 'project' AND lower(p1.title) LIKE "+in+") OR (p2.type = 'project' AND lower(p2.title) LIKE "+in+"))")
	}
	if p.from != nil {
		// Overlaps the period (daily tasks end at the midnight after their last day).
		from, to := arg(*p.from), arg(*p.to)
		conds = append(conds, "coalesce(t.start_at, t.end_at) < "+to+
			" AND CASE WHEN t.end_at IS NOT NULL THEN t.end_at > "+from+" ELSE t.start_at >= "+from+" END")
	}

	where := ""
	if len(conds) > 0 {
		where = " WHERE " + strings.Join(conds, " AND ")
	}
	score := fmt.Sprintf(`(CASE WHEN %s THEN 1000 ELSE 0 END + CASE WHEN %s THEN 20 ELSE 10 END + (%s) * 5
		+ CASE WHEN t.status <> 'done' THEN 5 ELSE 0 END)`, keyMatch, allLiteral, similarity)
	q := `SELECT ` + searchCols + searchFrom + where +
		` ORDER BY ` + score + ` DESC, abs(extract(epoch FROM coalesce(t.start_at, t.created_at) - ` + arg(sq.Now) + `)), t.number DESC LIMIT ` + strconv.Itoa(sq.Limit+1)
	// pg_trgm's default word-similarity cut-off (0.6) misses one-letter
	// typos in short words ("relase" vs "release" is 0.5); use 0.45 for
	// this query only (it still keeps "deploy" from matching "develop").
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return res, err
	}
	defer tx.Rollback(ctx)
	if trgm {
		if _, err := tx.Exec(ctx, `SET LOCAL pg_trgm.word_similarity_threshold = 0.45`); err != nil {
			return res, err
		}
	}
	out, err := scanResults(ctx, tx, q, args...)
	if err != nil {
		return res, err
	}
	if len(out) > sq.Limit {
		out, res.More = out[:sq.Limit], true
	}
	res.Results = out
	return res, nil
}

// SearchByIDs returns the given tasks in that order (recently opened ones),
// skipping those that are gone or outside workspaceIDs (nil means all).
func (s *Store) SearchByIDs(ctx context.Context, ids []string, workspaceIDs []string) ([]SearchResult, error) {
	if len(ids) == 0 {
		return []SearchResult{}, nil
	}
	q := `SELECT ` + searchCols + searchFrom + ` WHERE t.id::text = ANY($1) AND ($2::text[] IS NULL OR t.workspace_id::text = ANY($2))`
	found, err := scanResults(ctx, s.db, q, ids, workspaceIDs)
	if err != nil {
		return nil, err
	}
	byID := make(map[string]SearchResult, len(found))
	for _, r := range found {
		byID[r.ID] = r
	}
	out := make([]SearchResult, 0, len(found))
	for _, id := range ids {
		if r, ok := byID[id]; ok {
			out = append(out, r)
		}
	}
	return out, nil
}
