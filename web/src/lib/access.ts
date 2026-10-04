import { createContext, useContext } from 'react'
import { useMe } from './queries'

/**
 * What the signed-in user may do. Admins can do everything; others are
 * editors or viewers per workspace (the server enforces the same rules).
 */
export function useAccess() {
  const me = useMe().data
  const roles = me?.workspace_roles
  const canEdit = (workspaceId?: string | null) => !!me && (me.is_admin || (!!workspaceId && roles?.[workspaceId] === 'editor'))
  return {
    loaded: !!me,
    isAdmin: !!me?.is_admin,
    canEdit,
    /** Can create tasks somewhere (e.g. from the cross-workspace calendar). */
    canEditAny: !!me && (me.is_admin || Object.values(roles ?? {}).includes('editor')),
    canCreateWorkspace: !!me?.can_create_workspace,
  }
}

/** True inside a task dialog the user may only view. */
export const ReadOnlyContext = createContext(false)
export const useReadOnly = () => useContext(ReadOnlyContext)
