-- Per-workspace access for non-admin users. Admins (the Keycloak admin role)
-- can do everything everywhere; everyone else is an editor or viewer of a
-- workspace, or has no access ('none'). A user with no row for a workspace
-- gets the server's DEFAULT_WORKSPACE_ROLE (viewer unless configured).
CREATE TABLE workspace_members (
    workspace_id  uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    user_id       uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role          text NOT NULL CHECK (role IN ('editor', 'viewer', 'none')),
    PRIMARY KEY (workspace_id, user_id)
);
CREATE INDEX workspace_members_user_idx ON workspace_members (user_id);

-- Before roles existed everyone could edit everything: keep that for the
-- people and workspaces that exist today.
INSERT INTO workspace_members (workspace_id, user_id, role)
SELECT w.id, u.id, 'editor' FROM workspaces w CROSS JOIN users u;
