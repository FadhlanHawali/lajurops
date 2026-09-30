import { useEffect, useState } from 'react'
import clsx from 'clsx'
import { format } from 'date-fns'
import { ChevronLeft, ChevronRight, KeyRound, Loader2, Pencil, Plus, Search, ShieldCheck, Trash2, Wand2, X } from 'lucide-react'
import { Avatar, Button, Empty, Field, inputCls } from '../components/ui'
import { ApiError } from '../lib/api'
import { useAdminUsers, useDeleteAdminUser, useMe, useSaveAdminUser } from '../lib/queries'
import type { AdminUser, AdminUserInput } from '../lib/types'

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
        <Button variant="primary" className="ml-auto" onClick={() => setDialog({ kind: 'edit' })}>
          <Plus size={14} /> New user
        </Button>
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
                      <Avatar user={{ id: u.id, username: u.username, display_name: fullName(u), email: u.email, active: u.enabled, last_seen_at: '' }} size="md" />
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

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    const input: AdminUserInput = user ? { ...f, username: undefined } : { ...f, password, temporary_password: temporary }
    await save.mutateAsync({ id: user?.id, input }).then(onClose, () => {})
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
        <div className="space-y-2 rounded-md border border-slate-200 p-3">
          <label className={clsx('flex items-center gap-2 text-sm', self && 'opacity-50')}>
            <input type="checkbox" checked={f.is_admin} disabled={self} onChange={(e) => up({ is_admin: e.target.checked })} />
            <span>
              <span className="font-medium text-slate-700">Administrator</span>
              <span className="block text-xs text-slate-500">Can manage users.</span>
            </span>
          </label>
          <label className={clsx('flex items-center gap-2 text-sm', self && 'opacity-50')}>
            <input type="checkbox" checked={f.enabled} disabled={self} onChange={(e) => up({ enabled: e.target.checked })} />
            <span>
              <span className="font-medium text-slate-700">Enabled</span>
              <span className="block text-xs text-slate-500">Disabled users can't sign in and are hidden from assignee lists.</span>
            </span>
          </label>
        </div>
        {save.error && <p className="text-sm text-red-600">{save.error.message}</p>}
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
