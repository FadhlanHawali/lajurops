-- In-app notifications (the bell). One row per person and event; a few
-- events from the same person on the same task within minutes are grouped
-- into one row (data.changes). dedupe_key keeps reminders from repeating.
CREATE TABLE notifications (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    type        text NOT NULL,
    task_id     uuid REFERENCES tasks(id) ON DELETE CASCADE,
    actor_id    uuid REFERENCES users(id) ON DELETE SET NULL,
    data        jsonb NOT NULL DEFAULT '{}',
    dedupe_key  text,
    created_at  timestamptz NOT NULL DEFAULT now(),
    updated_at  timestamptz NOT NULL DEFAULT now(),
    read_at     timestamptz
);
CREATE INDEX notifications_user_idx ON notifications (user_id, updated_at DESC);
CREATE INDEX notifications_unread_idx ON notifications (user_id) WHERE read_at IS NULL;
CREATE UNIQUE INDEX notifications_dedupe_idx ON notifications (user_id, dedupe_key) WHERE dedupe_key IS NOT NULL;

-- What each person wants: types switched off, reminder lead times, and the
-- time zone (from their browser) for reminders at local times.
CREATE TABLE notification_settings (
    user_id      uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    disabled     text[] NOT NULL DEFAULT '{}',
    hourly_lead  integer NOT NULL DEFAULT 15 CHECK (hourly_lead BETWEEN 1 AND 120),
    step_lead    integer NOT NULL DEFAULT 10 CHECK (step_lead BETWEEN 1 AND 120),
    tz           text NOT NULL DEFAULT '',
    updated_at   timestamptz NOT NULL DEFAULT now()
);

-- Admins come from Keycloak; remembering it lets @mentions check whether the
-- mentioned person can see the workspace.
ALTER TABLE users ADD COLUMN is_admin boolean NOT NULL DEFAULT false;
