import { useEffect, useState } from 'react'
import { Navigate, NavLink, Route, Routes, useNavigate, useParams } from 'react-router-dom'
import clsx from 'clsx'
import { formatISO, startOfWeek } from 'date-fns'
import { AlertTriangle, BarChart3, CalendarDays, Eye, Download, FolderKanban, GanttChart, KanbanSquare, Loader2, LogOut, Plus, Settings, Target, Trash2, Upload, Users as UsersIcon } from 'lucide-react'
import { ImportDialog } from './components/ImportDialog'
import { TaskModalProvider, useTaskModal } from './components/TaskModal'
import { Avatar, Button, Field, inputCls, userName } from './components/ui'
import { useAccess } from './lib/access'
import { AUTH_ERROR_EVENT } from './lib/api'
import { accountUrl, authEnabled, logout } from './lib/auth'
import { downloadWorkspaceBackup, useCreateWorkspace, useDeleteWorkspace, useMe, useMyCommitment, useWorkspace, useWorkspaces } from './lib/queries'
import Board from './views/Board'
import Calendar from './views/Calendar'
import Commitments, { OverdueBadge } from './views/Commitments'
import Gantt from './views/Gantt'
import Reports from './views/Reports'
import Users from './views/Users'

export default function App() {
  return (
    <TaskModalProvider>
      <div className="flex h-screen bg-slate-50 text-slate-800">
        <Sidebar />
        <main className="flex min-w-0 flex-1 flex-col overflow-hidden">
          <AuthErrorBanner />
          <div className="min-h-0 flex-1">
            <Routes>
              <Route path="/" element={<Home />} />
              <Route path="/w/:workspaceId" element={<Navigate to="board" replace />} />
              <Route path="/w/:workspaceId/:view" element={<WorkspacePage />} />
              <Route
                path="/calendar"
                element={
                  <Page title="Calendar" subtitle="Tasks across all workspaces">
                    <Calendar />
                  </Page>
                }
              />
              <Route
                path="/reports"
                element={
                  <Page title="Hourly Workload" subtitle="Time each member spends on hourly tasks (support, deployments, implementation)">
                    <div className="h-full overflow-y-auto">
                      <Reports />
                    </div>
                  </Page>
                }
              />
              <Route
                path="/commitments"
                element={
                  <Page title="Weekly Commitment" subtitle="What each person commits to finishing this week">
                    <div className="h-full overflow-y-auto">
                      <Commitments />
                    </div>
                  </Page>
                }
              />
              <Route
                path="/admin/users"
                element={
                  <Page title="Users" subtitle="Manage who can sign in to LajurOps (stored in Keycloak)">
                    <div className="h-full overflow-y-auto">
                      <Users />
                    </div>
                  </Page>
                }
              />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </div>
        </main>
      </div>
    </TaskModalProvider>
  )
}

/** Explains why the server rejects our token, instead of failing silently. */
function AuthErrorBanner() {
  const [message, setMessage] = useState('')
  useEffect(() => {
    const on = (e: Event) => setMessage((e as CustomEvent<string>).detail)
    window.addEventListener(AUTH_ERROR_EVENT, on)
    return () => window.removeEventListener(AUTH_ERROR_EVENT, on)
  }, [])
  if (!message) return null
  return (
    <div className="flex items-start gap-2 border-b border-red-200 bg-red-50 px-4 py-2 text-sm text-red-800">
      <AlertTriangle size={16} className="mt-0.5 shrink-0" />
      <div className="min-w-0 flex-1">
        <b>The server rejected your sign-in.</b> <span className="break-words">{message}</span>
        <div className="text-xs text-red-700">The server log has more detail; ask your administrator to check the OIDC settings.</div>
      </div>
      <button className="text-xs font-medium underline" onClick={() => setMessage('')}>
        Dismiss
      </button>
    </div>
  )
}

function Sidebar() {
  const { data: workspaces = [] } = useWorkspaces()
  const { data: me } = useMe()
  const [creating, setCreating] = useState(false)
  const [importing, setImporting] = useState(false)
  const { canCreateWorkspace } = useAccess()
  // Unfinished commitments from earlier weeks, seen from this week.
  const overdue = useMyCommitment(formatISO(startOfWeek(new Date(), { weekStartsOn: 1 }))).data?.overdue.length ?? 0
  const link = ({ isActive }: { isActive: boolean }) =>
    clsx('flex items-center gap-2 rounded-md px-2.5 py-1.5 text-sm', isActive ? 'bg-slate-700 text-white' : 'text-slate-300 hover:bg-slate-800 hover:text-white')

  return (
    <aside className="hidden w-60 shrink-0 flex-col bg-slate-900 md:flex">
      <div className="flex items-center gap-2 px-4 py-4">
        <img src="/favicon.svg" className="h-7 w-7" alt="" />
        <span className="text-lg font-semibold tracking-tight text-white">
          Lajur<span className="text-sky-300">Ops</span>
        </span>
      </div>
      <nav className="flex-1 space-y-1 overflow-y-auto px-2">
        <NavLink to="/calendar" className={link}>
          <CalendarDays size={16} /> Calendar
        </NavLink>
        <NavLink to="/reports" className={link}>
          <BarChart3 size={16} /> Hourly Workload
        </NavLink>
        <NavLink to="/commitments" className={link}>
          <Target size={16} /> <span className="flex-1">Weekly Commitment</span>
          {overdue > 0 && <OverdueBadge count={overdue} />}
        </NavLink>
        {me?.is_admin && (
          <NavLink to="/admin/users" className={link}>
            <UsersIcon size={16} /> Users
          </NavLink>
        )}
        <div className="flex items-center justify-between px-2.5 pt-5 pb-1 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
          Workspaces
          {canCreateWorkspace && (
            <span className="flex items-center gap-0.5">
              <button className="rounded p-0.5 hover:bg-slate-800 hover:text-white" title="Import a workspace backup" onClick={() => setImporting(true)}>
                <Upload size={13} />
              </button>
              <button className="rounded p-0.5 hover:bg-slate-800 hover:text-white" title="New workspace" onClick={() => setCreating(true)}>
                <Plus size={14} />
              </button>
            </span>
          )}
        </div>
        {workspaces.map((p) => (
          <NavLink key={p.id} to={`/w/${p.id}/board`} className={({ isActive }) => link({ isActive: isActive || location.pathname.startsWith(`/w/${p.id}/`) })}>
            <FolderKanban size={16} />
            <span className="min-w-0 flex-1 truncate">{p.name}</span>
            <span className="text-[10px] text-slate-500">{p.key}</span>
          </NavLink>
        ))}
      </nav>
      {me && (
        <div className="flex items-center gap-2 border-t border-slate-800 px-4 py-3">
          <Avatar user={me} size="md" />
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm text-white">{userName(me)}</div>
            <div className="truncate text-xs text-slate-500">{me.email}</div>
          </div>
          {authEnabled() && (
            <>
              <a className="rounded p-1 text-slate-400 hover:bg-slate-800 hover:text-white" title="Account & password" href={accountUrl()} target="_blank" rel="noreferrer">
                <Settings size={16} />
              </a>
              <button className="rounded p-1 text-slate-400 hover:bg-slate-800 hover:text-white" title="Sign out" onClick={logout}>
                <LogOut size={16} />
              </button>
            </>
          )}
        </div>
      )}
      {creating && <NewWorkspaceDialog onClose={() => setCreating(false)} />}
      {importing && <ImportDialog onClose={() => setImporting(false)} />}
    </aside>
  )
}

function Page({ title, subtitle, actions, children }: { title: string; subtitle?: string; actions?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="flex h-full flex-col">
      <header className="flex flex-wrap items-center gap-3 border-b border-slate-200 bg-white px-6 py-3">
        <div>
          <h1 className="text-lg font-semibold">{title}</h1>
          {subtitle && <p className="text-xs text-slate-500">{subtitle}</p>}
        </div>
        <div className="ml-auto flex items-center gap-2">{actions}</div>
      </header>
      <div className="min-h-0 flex-1 p-4 md:p-6">{children}</div>
    </div>
  )
}

const VIEWS = [
  { id: 'board', label: 'Board', icon: KanbanSquare },
  { id: 'timeline', label: 'Timeline', icon: GanttChart },
  { id: 'calendar', label: 'Calendar', icon: CalendarDays },
]

function WorkspacePage() {
  const { workspaceId = '', view = 'board' } = useParams()
  const { data: workspace, error } = useWorkspace(workspaceId)
  const del = useDeleteWorkspace()
  const [exporting, setExporting] = useState(false)
  const navigate = useNavigate()
  const modal = useTaskModal()
  const canEdit = useAccess().canEdit(workspaceId)
  if (error) return <Navigate to="/" replace />

  return (
    <Page
      title={workspace ? workspace.name : '…'}
      subtitle={workspace ? `${workspace.key} · ${workspace.task_count} tasks` : undefined}
      actions={
        <>
          <nav className="flex rounded-md border border-slate-300 bg-slate-50 p-0.5 text-sm">
            {VIEWS.map((v) => (
              <NavLink
                key={v.id}
                to={`/w/${workspaceId}/${v.id}${location.search}`}
                className={({ isActive }) => clsx('flex items-center gap-1.5 rounded px-3 py-1', isActive ? 'bg-white font-medium shadow-sm' : 'text-slate-600 hover:text-slate-900')}
              >
                <v.icon size={14} /> {v.label}
              </NavLink>
            ))}
          </nav>
          {canEdit ? (
            <Button variant="primary" onClick={() => modal.createTask({ title: '', workspace_id: workspaceId })}>
              <Plus size={14} /> Create
            </Button>
          ) : (
            <span className="flex items-center gap-1 rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-600" title="You have viewer access to this workspace">
              <Eye size={13} /> View only
            </span>
          )}
          <Button
            variant="ghost"
            title="Export a backup of this workspace (.json)"
            disabled={!workspace || exporting}
            onClick={async () => {
              if (!workspace) return
              setExporting(true)
              try {
                await downloadWorkspaceBackup(workspace.id, workspace.key)
              } catch (e) {
                alert(`Export failed: ${(e as Error).message}`)
              } finally {
                setExporting(false)
              }
            }}
          >
            {exporting ? <Loader2 size={16} className="animate-spin" /> : <Download size={16} />}
          </Button>
          {canEdit && (
            <Button
              variant="ghost"
              title="Delete workspace"
              onClick={async () => {
                if (workspace && confirm(`Delete workspace ${workspace.name} and all ${workspace.task_count} tasks? This cannot be undone.`)) {
                  await del.mutateAsync(workspace.id)
                  navigate('/')
                }
              }}
            >
              <Trash2 size={16} />
            </Button>
          )}
        </>
      }
    >
      {view === 'timeline' ? <Gantt workspaceId={workspaceId} /> : view === 'calendar' ? <Calendar workspaceId={workspaceId} /> : <Board workspaceId={workspaceId} />}
    </Page>
  )
}

function Home() {
  const { data: workspaces, isLoading } = useWorkspaces()
  const [importing, setImporting] = useState(false)
  const access = useAccess()
  if (isLoading || !access.loaded) return null
  if (workspaces?.length) return <Navigate to={`/w/${workspaces[0].id}/board`} replace />
  if (!access.canCreateWorkspace)
    return (
      <div className="flex h-full items-center justify-center p-6">
        <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-6 text-center shadow-sm">
          <h1 className="text-xl font-semibold">No workspaces yet</h1>
          <p className="mt-1 text-sm text-slate-500">You don't have access to any workspace. Ask an administrator to give you access.</p>
        </div>
      </div>
    )
  return (
    <div className="flex h-full items-center justify-center p-6">
      <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <h1 className="text-xl font-semibold">Welcome to LajurOps</h1>
        <p className="mt-1 mb-4 text-sm text-slate-500">Create your first workspace to start planning tasks.</p>
        <NewWorkspaceForm />
        <p className="mt-4 border-t border-slate-100 pt-3 text-center text-sm text-slate-500">
          Have a backup?{' '}
          <button className="font-medium text-blue-600 hover:underline" onClick={() => setImporting(true)}>
            Import a workspace
          </button>
        </p>
      </div>
      {importing && <ImportDialog onClose={() => setImporting(false)} />}
    </div>
  )
}

function NewWorkspaceDialog({ onClose }: { onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-slate-900/40 p-4 pt-[15vh]" onMouseDown={onClose}>
      <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-2xl" onMouseDown={(e) => e.stopPropagation()}>
        <h2 className="mb-4 text-lg font-semibold">New workspace</h2>
        <NewWorkspaceForm onDone={onClose} />
      </div>
    </div>
  )
}

function NewWorkspaceForm({ onDone }: { onDone?: () => void }) {
  const [name, setName] = useState('')
  const [key, setKey] = useState('')
  const [keyTouched, setKeyTouched] = useState(false)
  const [description, setDescription] = useState('')
  const create = useCreateWorkspace()
  const navigate = useNavigate()

  const suggestKey = (n: string) =>
    (n.split(/\s+/).filter(Boolean).length > 1 ? n.split(/\s+/).map((w) => w[0]).join('') : n)
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, '')
      .replace(/^[0-9]+/, '')
      .slice(0, 6)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    const p = await create.mutateAsync({ name, key, description })
    onDone?.()
    navigate(`/w/${p.id}/board`)
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <Field label="Name">
        <input
          autoFocus
          className={inputCls}
          value={name}
          placeholder="Platform Operations"
          onChange={(e) => {
            setName(e.target.value)
            if (!keyTouched) setKey(suggestKey(e.target.value))
          }}
        />
      </Field>
      <Field label="Key (prefix for task ids, e.g. OPS-12)">
        <input
          className={inputCls}
          value={key}
          onChange={(e) => {
            setKeyTouched(true)
            setKey(e.target.value.toUpperCase())
          }}
        />
      </Field>
      <Field label="Description">
        <textarea className={inputCls} value={description} onChange={(e) => setDescription(e.target.value)} />
      </Field>
      {create.error && <p className="text-sm text-red-600">{create.error.message}</p>}
      <div className="flex justify-end gap-2">
        {onDone && (
          <Button type="button" onClick={onDone}>
            Cancel
          </Button>
        )}
        <Button variant="primary" type="submit" disabled={!name || !key || create.isPending}>
          Create workspace
        </Button>
      </div>
    </form>
  )
}
