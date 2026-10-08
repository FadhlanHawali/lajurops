-- Search (Ctrl+K) matches task titles by substring and, with pg_trgm, by
-- similar words so typos still find the task. pg_trgm ships with Postgres
-- and is a trusted extension (13+), so the database owner can enable it; if
-- it can't be enabled, search still works without typo tolerance.
DO $$
BEGIN
    CREATE EXTENSION IF NOT EXISTS pg_trgm;
EXCEPTION WHEN insufficient_privilege OR undefined_file OR feature_not_supported THEN
    RAISE NOTICE 'pg_trgm is not available: search works without typo tolerance';
END $$;

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_trgm') THEN
        EXECUTE 'CREATE INDEX IF NOT EXISTS tasks_title_trgm_idx ON tasks USING gin (lower(title) gin_trgm_ops)';
    END IF;
END $$;
