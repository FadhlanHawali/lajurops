-- Set when a user no longer exists in Keycloak ("Sync with Keycloak" or a
-- delete from the Users page). Disabled users only have active = false.
ALTER TABLE users ADD COLUMN deleted_at timestamptz;
