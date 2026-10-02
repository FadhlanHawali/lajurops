package store

import (
	"testing"
	"time"
)

func TestMergedHours(t *testing.T) {
	day := time.Date(2026, 9, 28, 0, 0, 0, 0, time.UTC)
	at := func(h, m int) time.Time { return day.Add(time.Duration(h)*time.Hour + time.Duration(m)*time.Minute) }
	cases := []struct {
		name  string
		spans []span
		want  float64
	}{
		{"none", nil, 0},
		{"parallel", []span{{at(9, 0), at(11, 0)}, {at(9, 0), at(11, 30)}}, 2.5},
		{"partial overlap", []span{{at(9, 0), at(11, 0)}, {at(10, 0), at(12, 0)}}, 3},
		{"contained", []span{{at(9, 0), at(17, 0)}, {at(10, 0), at(11, 0)}}, 8},
		{"back to back", []span{{at(9, 0), at(10, 0)}, {at(10, 0), at(11, 0)}}, 2},
		{"separate", []span{{at(13, 0), at(14, 0)}, {at(9, 0), at(10, 30)}}, 2.5},
		{"chain", []span{{at(9, 0), at(10, 0)}, {at(9, 30), at(11, 0)}, {at(10, 45), at(12, 0)}, {at(15, 0), at(16, 0)}}, 4},
	}
	for _, c := range cases {
		if got := mergedHours(c.spans); got != c.want {
			t.Errorf("%s: got %v, want %v", c.name, got, c.want)
		}
	}
}
