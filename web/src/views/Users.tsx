import { useEffect, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import clsx from 'clsx'
import { format } from 'date-fns'
import { ChevronLeft, ChevronRight, KeyRound, Loader2, Pencil, Plus, RefreshCw, Search, ShieldCheck, Trash2, UserX, Wand2, X } from 'lucide-react'
import { Avatar, Button, Empty, Field, inputCls } from '../components/ui'
import { ApiError } from '../lib/api'
import { appConfig } from '../lib/auth'
import { saveUserAccess, useAdminUsers, useDeleteAdminUser, useMe, usePurgeUser, useRemovedUsers, useSaveAdminUser, useSyncUsers, useUserAccess, useWorkspaces } from '../lib/queries'
import type { AdminUser, AdminUserInput, MemberRole, RemovedUser } from '../lib/types'

const PAGE = 20

const fullName = (u: AdminUser) => `${u.first_name} ${u.last_name}`.trim() || u.username

type Dialog = { kind: 'edit'; user?: AdminUser } | { kind: 'password'; user: AdminUser } | null

export default function Users() {
  const [query, setQuery] = useState('')
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(0)
  const [dialog, setDialog] = useState<Dialog>(null)
  const { data, isLoading, error, isFetching } = useAdminUsers(search, page * PAGE, PAGE)
  const del = useDeleteAdminUser()
  const me = useMe().data

  // Debounce the search box.
  useEffect(() => {
    const t = setTimeout(() => {
      setSearch(query.trim())
      setPage(0)
    }, 300)
    return () => clearTimeout(t)
  }, [query])

  if (error) {
    const status = error instanceof ApiError ? error.status : 0
    return (
      <Empty>
        <p className="font-medium text-slate-700">{status === 403 ? 'Only administrators can manage users.' : 'User management is unavailable.'}</p>
        <p className="mt-1">{error.message}</p>
      </Empty>
    )
  }

  const users = data?.users ?? []
  const total = data?.total ?? 0
  const pages = Math.max(1, Math.ceil(total / PAGE))

  const remove = async (u: AdminUser) => {
    if (!confirm(`Delete ${fullName(u)} (${u.username})?\n\nThey will no longer be able to sign in. Their existing tasks and reports are kept.`)) return
    try {
      await del.mutateAsync(u.id)
    } catch (e) {
      alert((e as Error).message)
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-full max-w-xs">
          <Search size={14} className="absolute top-1/2 left-2.5 -translate-y-1/2 text-slate-400" />
          <input className={clsx(inputCls, 'pl-8')} placeholder="Search name, username or email" value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
        {isFetching && <Loader2 size={16} className="animate-spin text-slate-400" />}
        <div className="ml-auto flex items-center gap-2">
          <SyncButton />
          <Button variant="primary" onClick={() => setDialog({ kind: 'edit' })}>
            <Plus size={14} /> New user
          </Button>
        </div>
      </div>

      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table className="w-full min-w-[820px] text-sm">
          <thead className="border-b border-slate-200 bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-2">User</th>
              <th className="px-4 py-2">Email</th>
              <th className="px-4 py-2">Role</th>
              <th className="px-4 py-2">Status</th>
              <th className="px-4 py-2">Created</th>
              <th className="px-4 py-2 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {isLoading && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-slate-400">
                  Loading…
                </td>
              </tr>
            )}
            {!isLoading && users.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-slate-500">
                  {search ? 'No users match your search.' : 'No users yet.'}
                </td>
              </tr>
            )}
            {users.map((u) => {
              const self = u.username === me?.username
              return (
                <tr key={u.id} className="border-b border-slate-100 last:border-0 hover:bg-slate-50">
                  <td className="px-4 py-2.5">
                    <div className="flex items-center gap-2.5">
                      <Avatar user={{ id: u.id, username: u.username, display_name: fullName(u), email: u.email, active: u.enabled, last_seen_at: '', deleted_at: null }} size="md" />
                      <div>
                        <div className="font-medium text-slate-800">
                          {fullName(u)} {self && <span className="text-xs font-normal text-slate-400">(you)</span>}
                        </div>
                        <div className="text-xs text-slate-500">{u.username}</div>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-2.5 text-slate-600">{u.email || <span className="text-slate-400">—</span>}</td>
                  <td className="px-4 py-2.5">
                    {u.is_admin ? (
                      <span className="inline-flex items-center gap-1 rounded bg-indigo-100 px-1.5 py-0.5 text-xs font-medium text-indigo-700">
                        <ShieldCheck size={12} /> Admin
                      </span>
                    ) : (
                      <span className="text-xs text-slate-500">Member</span>
                    )}
                  </td>
                  <td className="px-4 py-2.5">
                    <span className={clsx('rounded px-1.5 py-0.5 text-xs font-medium', u.enabled ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-200 text-slate-600')}>
                      {u.enabled ? 'Active' : 'Disabled'}
                    </span>
                    {u.required_actions.includes('UPDATE_PASSWORD') && <span className="ml-1.5 text-xs text-amber-600">must change password</span>}
                  </td>
                  <td className="px-4 py-2.5 text-xs text-slate-500">{u.created_at ? format(new Date(u.created_at), 'MMM d, yyyy') : '—'}</td>
                  <td className="px-4 py-2.5">
                    <div className="flex justify-end gap-1">
                      <Button variant="ghost" title="Edit" onClick={() => setDialog({ kind: 'edit', user: u })}>
                        <Pencil size={14} />
                      </Button>
                      <Button variant="ghost" title="Reset password" onClick={() => setDialog({ kind: 'password', user: u })}>
                        <KeyRound size={14} />
                      </Button>
                      <Button variant="ghost" title={self ? 'You cannot delete yourself' : 'Delete'} disabled={self} onClick={() => remove(u)}>
                        <Trash2 size={14} className="text-red-500" />
                      </Button>
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between text-sm text-slate-500">
        <span>
          {total} user{total === 1 ? '' : 's'}
        </span>
        <div className="flex items-center gap-2">
          <Button variant="ghost" disabled={page === 0} onClick={() => setPage(page - 1)}>
            <ChevronLeft size={16} />
          </Button>
          Page {page + 1} of {pages}
          <Button variant="ghost" disabled={page + 1 >= pages} onClick={() => setPage(page + 1)}>
            <ChevronRight size={16} />
          </Button>
        </div>
      </div>

      <RemovedUsers />

      {dialog?.kind === 'edit' && <UserDialog user={dialog.user} self={dialog.user?.username === me?.username} onClose={() => setDialog(null)} />}
      {dialog?.kind === 'password' && <PasswordDialog user={dialog.user} onClose={() => setDialog(null)} />}
    </div>
  )
}

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/40 p-4 pt-[10vh]" onMouseDown={onClose}>
      <div className="w-full max-w-lg rounded-xl bg-white shadow-2xl" onMouseDown={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3">
          <h2 className="font-semibold">{title}</h2>
          <Button variant="ghost" onClick={onClose}>
            <X size={16} />
          </Button>
        </div>
        {children}
      </div>
    </div>
  )
}

function generatePassword() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789!@#$%*-_'
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  return Array.from(bytes, (b) => chars[b % chars.length]).join('')
}

function PasswordFields({
  password,
  setPassword,
  temporary,
  setTemporary,
}: {
  password: string
  setPassword: (v: string) => void
  temporary: boolean
  setTemporary: (v: boolean) => void
}) {
  return (
    <>
      <Field label="Password (min. 8 characters)">
        <div className="flex gap-2">
          <input className={inputCls} type="text" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
          <Button type="button" title="Generate a random password" onClick={() => setPassword(generatePassword())}>
            <Wand2 size={14} />
          </Button>
        </div>
      </Field>
      <label className="flex items-center gap-2 text-sm text-slate-600">
        <input type="checkbox" checked={temporary} onChange={(e) => setTemporary(e.target.checked)} />
        Require a new password at next sign-in
      </label>
    </>
  )
}

function UserDialog({ user, self, onClose }: { user?: AdminUser; self: boolean; onClose: () => void }) {
  const [f, setF] = useState<AdminUserInput>({
    username: user?.username ?? '',
    email: user?.email ?? '',
    first_name: user?.first_name ?? '',
    last_name: user?.last_name ?? '',
    enabled: user?.enabled ?? true,
    is_admin: user?.is_admin ?? false,
  })
  const [password, setPassword] = useState('')
  const [temporary, setTemporary] = useState(true)
  const save = useSaveAdminUser()
  const up = (patch: AdminUserInput) => setF((s) => ({ ...s, ...patch }))
  const access = useAccessDraft(user?.id)
  const [accessError, setAccessError] = useState('')
  const qc = useQueryClient()

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setAccessError('')
    const input: AdminUserInput = user ? { ...f, username: undefined } : { ...f, password, temporary_password: temporary }
    let saved: AdminUser
    try {
      saved = await save.mutateAsync({ id: user?.id, input })
    } catch {
      return
    }
    // Admins can do everything, so only members' workspace roles matter.
    if (!f.is_admin && access.dirty) {
      try {
        await saveUserAccess(saved.id, access.roles)
        qc.invalidateQueries({ queryKey: ['user-access', saved.id] })
      } catch (err) {
        return setAccessError(`User saved, but workspace access wasn't: ${(err as Error).message}`)
      }
    }
    onClose()
  }

  return (
    <Modal title={user ? `Edit ${user.username}` : 'New user'} onClose={onClose}>
      <form onSubmit={submit} className="space-y-3 p-5">
        <Field label="Username">
          <input className={inputCls} value={f.username} disabled={!!user} autoFocus={!user} onChange={(e) => up({ username: e.target.value })} placeholder="jdoe" />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="First name">
            <input className={inputCls} value={f.first_name} onChange={(e) => up({ first_name: e.target.value })} />
          </Field>
          <Field label="Last name">
            <input className={inputCls} value={f.last_name} onChange={(e) => up({ last_name: e.target.value })} />
          </Field>
        </div>
        <Field label="Email">
          <input className={inputCls} type="email" value={f.email} onChange={(e) => up({ email: e.target.value })} />
        </Field>
        {!user && <PasswordFields password={password} setPassword={setPassword} temporary={temporary} setTemporary={setTemporary} />}
        <Field label="Role">
          <div className={clsx('grid grid-cols-2 gap-2', self && 'opacity-60')}>
            {(
              [
                [true, 'Admin', 'Full access to every workspace; manages users.'],
                [false, 'Member', 'Editor or viewer, chosen per workspace below.'],
              ] as const
            ).map(([admin, label, hint]) => (
              <button
                key={label}
                type="button"
                disabled={self}
                title={self ? "You can't change your own role" : undefined}
                onClick={() => up({ is_admin: admin })}
                className={clsx(
                  'rounded-md border px-2.5 py-1.5 text-left transition',
                  f.is_admin === admin ? 'border-blue-500 bg-blue-50 ring-1 ring-blue-500' : 'border-slate-200 hover:border-slate-300',
                )}
              >
                <span className="flex items-center gap-1 text-sm font-semibold text-slate-800">
                  {admin && <ShieldCheck size={13} className="text-indigo-600" />} {label}
                </span>
                <span className="block text-[11px] leading-tight text-slate-500">{hint}</span>
              </button>
            ))}
          </div>
        </Field>
        {f.is_admin ? (
          <p className="rounded-md bg-indigo-50 px-3 py-2 text-xs text-indigo-800">Admins can view and edit every workspace, including new ones.</p>
        ) : (
          <WorkspaceAccess draft={access} />
        )}
        <div className="space-y-2 rounded-md border border-slate-200 p-3">
          <label className={clsx('flex items-center gap-2 text-sm', self && 'opacity-50')}>
            <input type="checkbox" checked={f.enabled} disabled={self} onChange={(e) => up({ enabled: e.target.checked })} />
            <span>
              <span className="font-medium text-slate-700">Enabled</span>
              <span className="block text-xs text-slate-500">Disabled users can't sign in and are hidden from assignee lists.</span>
            </span>
          </label>
        </div>
        {save.error && <p className="text-sm text-red-600">{save.error.message}</p>}
        {accessError && <p className="text-sm text-red-600">{accessError}</p>}
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" type="submit" disabled={save.isPending || !f.username || (!user && password.length < 8)}>
            {save.isPending && <Loader2 size={14} className="animate-spin" />}
            {user ? 'Save' : 'Create user'}
          </Button>
        </div>
      </form>
    </Modal>
  )
}

function PasswordDialog({ user, onClose }: { user: AdminUser; onClose: () => void }) {
  const [password, setPassword] = useState('')
  const [temporary, setTemporary] = useState(true)
  const save = useSaveAdminUser()

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    await save.mutateAsync({ id: user.id, input: { password, temporary_password: temporary } }).then(onClose, () => {})
  }

  return (
    <Modal title={`Reset password for ${user.username}`} onClose={onClose}>
      <form onSubmit={submit} className="space-y-3 p-5">
        <PasswordFields password={password} setPassword={setPassword} temporary={temporary} setTemporary={setTemporary} />
        <p className="text-xs text-slate-500">Share the new password with the user through a secure channel.</p>
        {save.error && <p className="text-sm text-red-600">{save.error.message}</p>}
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" type="submit" disabled={save.isPending || password.length < 8}>
            Set password
          </Button>
        </div>
      </form>
    </Modal>
  )
}

// --- users deleted in Keycloak --------------------------------------------------

/** Planner users whose Keycloak account is gone, with a way to remove them. */
function RemovedUsers() {
  const { data = [] } = useRemovedUsers()
  const [target, setTarget] = useState<RemovedUser | null>(null)
  if (data.length === 0) return null
  return (
    <section className="rounded-lg border border-red-200 bg-white">
      <div className="flex items-center gap-2 border-b border-red-100 bg-red-50/60 px-4 py-2.5">
        <UserX size={16} className="text-red-600" />
        <h2 className="text-sm font-semibold text-slate-800">Deleted in Keycloak</h2>
        <span className="text-xs text-slate-500">
          These people can no longer sign in. They're kept in LajurOps so their tasks and reports still show who did the work.
        </span>
      </div>
      <table className="w-full text-sm">
        <tbody>
          {data.map((u) => (
            <tr key={u.id} className="border-b border-slate-100 last:border-0">
              <td className="px-4 py-2.5">
                <div className="flex items-center gap-2.5">
                  <Avatar user={u} size="md" />
                  <div>
                    <div className="font-medium text-slate-800">{u.display_name || u.username}</div>
                    <div className="text-xs text-slate-500">{u.username}</div>
                  </div>
                </div>
              </td>
              <td className="px-4 py-2.5">
                <span className="rounded bg-red-100 px-1.5 py-0.5 text-xs font-semibold text-red-700">Deleted</span>
                {u.deleted_at && <span className="ml-2 text-xs text-slate-400">noticed {format(new Date(u.deleted_at), 'MMM d, yyyy HH:mm')}</span>}
              </td>
              <td className="px-4 py-2.5 text-xs text-slate-500">
                {u.sole_tasks + u.shared_tasks === 0 ? 'No tasks' : `${u.sole_tasks + u.shared_tasks} assigned task${u.sole_tasks + u.shared_tasks === 1 ? '' : 's'}`}
                {u.comments > 0 && ` · ${u.comments} comment${u.comments === 1 ? '' : 's'}`}
              </td>
              <td className="px-4 py-2.5 text-right">
                <Button variant="danger" onClick={() => setTarget(u)}>
                  <Trash2 size={14} /> Remove from LajurOps…
                </Button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {target && <PurgeDialog user={target} onClose={() => setTarget(null)} />}
    </section>
  )
}

function PurgeDialog({ user, onClose }: { user: RemovedUser; onClose: () => void }) {
  const [deleteTasks, setDeleteTasks] = useState(false)
  const purge = usePurgeUser()
  const name = user.display_name || user.username
  const total = user.sole_tasks + user.shared_tasks

  const submit = async () => {
    await purge.mutateAsync({ id: user.id, deleteTasks }).then(onClose, () => {})
  }

  return (
    <Modal title={`Remove ${name} from LajurOps`} onClose={onClose}>
      <div className="space-y-3 p-5 text-sm">
        {total === 0 ? (
          <p className="text-slate-600">{name}'s Keycloak account no longer exists and they have no tasks in LajurOps. Remove them from LajurOps?</p>
        ) : (
          <p className="text-slate-600">
            {name}'s Keycloak account no longer exists. Choose what happens to the {total} task{total === 1 ? '' : 's'} assigned to them.
          </p>
        )}
        {total > 0 && (
          <>
            <label className={clsx('flex cursor-pointer gap-3 rounded-lg border p-3', !deleteTasks ? 'border-blue-500 bg-blue-50/50 ring-1 ring-blue-500' : 'border-slate-200')}>
              <input type="radio" className="mt-1" checked={!deleteTasks} onChange={() => setDeleteTasks(false)} />
              <span>
                <span className="block font-medium text-slate-800">Keep their tasks</span>
                <span className="block text-xs text-slate-500">Remove {name} from {total} task{total === 1 ? '' : 's'}; the tasks stay, unassigned where nobody else is on them.</span>
              </span>
            </label>
            <label className={clsx('flex cursor-pointer gap-3 rounded-lg border p-3', deleteTasks ? 'border-red-500 bg-red-50/50 ring-1 ring-red-500' : 'border-slate-200')}>
              <input type="radio" className="mt-1" checked={deleteTasks} onChange={() => setDeleteTasks(true)} />
              <span>
                <span className="block font-medium text-slate-800">Delete their tasks</span>
                <span className="block text-xs text-slate-500">
                  Permanently delete the <b>{user.sole_tasks}</b> task{user.sole_tasks === 1 ? '' : 's'} only {name} owns (with everything inside them).
                  {user.shared_tasks > 0 && (
                    <>
                      {' '}
                      The other <b>{user.shared_tasks}</b> are shared with someone or contain someone else's work, so they're only unassigned.
                    </>
                  )}
                </span>
              </span>
            </label>
          </>
        )}
        {user.comments > 0 && <p className="text-xs text-slate-500">Their {user.comments} comment{user.comments === 1 ? '' : 's'} stay, shown as by a deleted user.</p>}
        {purge.error && <p className="text-sm text-red-600">{purge.error.message}</p>}
        <div className="flex justify-end gap-2 pt-2">
          <Button onClick={onClose}>Cancel</Button>
          <Button variant={deleteTasks ? 'danger' : 'primary'} onClick={submit} disabled={purge.isPending}>
            {purge.isPending && <Loader2 size={14} className="animate-spin" />}
            {total === 0 ? 'Remove user' : deleteTasks ? `Remove user and delete ${user.sole_tasks} task${user.sole_tasks === 1 ? '' : 's'}` : 'Remove user, keep tasks'}
          </Button>
        </div>
      </div>
    </Modal>
  )
}

/** Pulls every Keycloak user into the planner and flags accounts deleted there. */
function SyncButton() {
  const sync = useSyncUsers()
  const [msg, setMsg] = useState('')
  const run = async () => {
    setMsg('')
    const r = await sync.mutateAsync().catch(() => null)
    if (!r) return
    const parts = [`${r.in_keycloak} user${r.in_keycloak === 1 ? '' : 's'} in Keycloak`]
    if (r.marked_deleted.length) parts.push(`marked deleted: ${r.marked_deleted.join(', ')}`)
    if (r.restored.length) parts.push(`back in Keycloak: ${r.restored.join(', ')}`)
    if (!r.marked_deleted.length && !r.restored.length) parts.push('everything already in sync')
    setMsg(parts.join(' · '))
  }
  return (
    <div className="flex items-center gap-2">
      {msg && <span className="text-xs text-slate-500">{msg}</span>}
      {sync.error && <span className="text-xs text-red-600">{sync.error.message}</span>}
      <Button onClick={run} disabled={sync.isPending} title="Update LajurOps with Keycloak's current users">
        <RefreshCw size={14} className={clsx(sync.isPending && 'animate-spin')} /> Sync with Keycloak
      </Button>
    </div>
  )
}

const ROLE_OPTIONS: { id: MemberRole; label: string; hint: string }[] = [
  { id: 'editor', label: 'Editor', hint: 'Create, edit and delete tasks' },
  { id: 'viewer', label: 'Viewer', hint: 'Read only' },
  { id: 'none', label: 'No access', hint: "Can't see this workspace" },
]

/** A user's workspace roles being edited; new users start at the server default. */
function useAccessDraft(keycloakId?: string) {
  const { data: current } = useUserAccess(keycloakId)
  const { data: workspaces = [] } = useWorkspaces()
  const defaultRole: MemberRole = current?.default_role ?? appConfig().default_workspace_role ?? 'viewer'
  const [edits, setEdits] = useState<Record<string, MemberRole>>({})
  const rows = (current?.workspaces ?? workspaces.map((w) => ({ workspace_id: w.id, key: w.key, name: w.name, role: defaultRole, explicit: false }))).map((r) => ({
    ...r,
    role: edits[r.workspace_id] ?? r.role,
  }))
  return {
    rows,
    loading: !!keycloakId && !current,
    defaultRole,
    dirty: Object.keys(edits).length > 0,
    /** Every workspace's role, so the saved state is exactly what's shown. */
    roles: Object.fromEntries(rows.map((r) => [r.workspace_id, r.role])) as Record<string, MemberRole>,
    set: (id: string, role: MemberRole) => setEdits((e) => ({ ...e, [id]: role })),
    setAll: (role: MemberRole) => setEdits(Object.fromEntries(rows.map((r) => [r.workspace_id, role]))),
  }
}

function WorkspaceAccess({ draft }: { draft: ReturnType<typeof useAccessDraft> }) {
  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between">
        <span className="text-xs font-medium text-slate-600">Workspace access</span>
        {draft.rows.length > 1 && (
          <span className="flex items-center gap-1 text-[11px] text-slate-500">
            Set all:
            {ROLE_OPTIONS.map((o) => (
              <button key={o.id} type="button" className="rounded px-1 font-medium text-blue-600 hover:bg-blue-50" onClick={() => draft.setAll(o.id)}>
                {o.label}
              </button>
            ))}
          </span>
        )}
      </div>
      {draft.loading ? (
        <div className="h-20 animate-pulse rounded-md bg-slate-100" />
      ) : draft.rows.length === 0 ? (
        <p className="rounded-md border border-dashed border-slate-300 px-3 py-3 text-center text-xs text-slate-500">No workspaces yet.</p>
      ) : (
        <ul className="max-h-56 divide-y divide-slate-100 overflow-y-auto rounded-md border border-slate-200">
          {draft.rows.map((r) => (
            <li key={r.workspace_id} className="flex items-center gap-2 px-3 py-1.5">
              <span className="w-14 shrink-0 text-xs font-medium text-slate-400">{r.key}</span>
              <span className="min-w-0 flex-1 truncate text-sm text-slate-800">{r.name}</span>
              <div className="flex shrink-0 overflow-hidden rounded-md border border-slate-300 text-xs">
                {ROLE_OPTIONS.map((o) => (
                  <button
                    key={o.id}
                    type="button"
                    title={o.hint}
                    onClick={() => draft.set(r.workspace_id, o.id)}
                    className={clsx(
                      'px-2 py-1 font-medium transition',
                      r.role === o.id ? (o.id === 'none' ? 'bg-slate-600 text-white' : o.id === 'editor' ? 'bg-blue-600 text-white' : 'bg-emerald-600 text-white') : 'bg-white text-slate-600 hover:bg-slate-50',
                    )}
                  >
                    {o.label}
                  </button>
                ))}
              </div>
            </li>
          ))}
        </ul>
      )}
      <p className="mt-1 text-[11px] text-slate-400">
        Workspaces created later default to <b>{ROLE_OPTIONS.find((o) => o.id === draft.defaultRole)?.label}</b> for this user.
      </p>
    </div>
  )
}
