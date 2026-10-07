-- Weekly commitments: each person picks the daily and hourly tasks they
-- intend to finish in a week. week_start is the Monday the week starts on
-- (in the person's time zone).
CREATE TABLE commitments (
    user_id         uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    week_start      date NOT NULL CHECK (extract(isodow FROM week_start) = 1),
    capacity_hours  numeric(5,2) NOT NULL DEFAULT 40 CHECK (capacity_hours >= 0 AND capacity_hours <= 168),
    note            text NOT NULL DEFAULT '',
    updated_at      timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, week_start)
);
CREATE INDEX commitments_week_idx ON commitments (week_start);

CREATE TABLE commitment_tasks (
    user_id     uuid NOT NULL,
    week_start  date NOT NULL,
    task_id     uuid NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    position    int  NOT NULL DEFAULT 0,
    PRIMARY KEY (user_id, week_start, task_id),
    FOREIGN KEY (user_id, week_start) REFERENCES commitments(user_id, week_start) ON DELETE CASCADE
);
CREATE INDEX commitment_tasks_task_idx ON commitment_tasks (task_id);
