-- Users disabled or deleted in Keycloak stay for history (assignments,
-- reports) but are hidden from assignee pickers.
ALTER TABLE users ADD COLUMN active boolean NOT NULL DEFAULT true;
