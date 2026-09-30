import { useState } from 'react'
import { Navigate, NavLink, Route, Routes, useNavigate, useParams } from 'react-router-dom'
import clsx from 'clsx'
import { BarChart3, CalendarDays, FolderKanban, GanttChart, KanbanSquare, LogOut, Plus, Trash2 } from 'lucide-react'
import { TaskModalProvider, useTaskModal } from './components/TaskModal'
import { Avatar, Button, Field, inputCls, userName } from './components/ui'
import { authEnabled, logout } from './lib/auth'
import { useCreateProject, useDeleteProject, useMe, useProject, useProjects } from './lib/queries'
import Board from './views/Board'
import Calendar from './views/Calendar'
import Gantt from './views/Gantt'
import Reports from './views/Reports'

export default function App() {
  return (
    <TaskModalProvider>
      <div className="flex h-screen bg-slate-50 text-slate-800">
        <Sidebar />
        <main className="min-w-0 flex-1 overflow-hidden">
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/p/:projectId" element={<Navigate to="board" replace />} />
            <Route path="/p/:projectId/:view" element={<ProjectPage />} />
            <Route
              path="/calendar"
              element={
                <Page title="Calendar" subtitle="Tasks across all projects">
                  <Calendar />
                </Page>
              }
            />
            <Route
              path="/reports"
              element={
                <Page title="Workload" subtitle="Tasks and hourly support hours per member">
                  <div className="h-full overflow-y-auto">
                    <Reports />
                  </div>
                </Page>
              }
            />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </main>
      </div>
    </TaskModalProvider>
  )
}

function Sidebar() {
  const { data: projects = [] } = useProjects()
  const { data: me } = useMe()
  const [creating, setCreating] = useState(false)
  const link = ({ isActive }: { isActive: boolean }) =>
    clsx('flex items-center gap-2 rounded-md px-2.5 py-1.5 text-sm', isActive ? 'bg-slate-700 text-white' : 'text-slate-300 hover:bg-slate-800 hover:text-white')

  return (
    <aside className="hidden w-60 shrink-0 flex-col bg-slate-900 md:flex">
      <div className="flex items-center gap-2 px-4 py-4">
        <img src="/favicon.svg" className="h-7 w-7" alt="" />
        <span className="text-lg font-semibold text-white">Open Planner</span>
      </div>
      <nav className="flex-1 space-y-1 overflow-y-auto px-2">
        <NavLink to="/calendar" className={link}>
          <CalendarDays size={16} /> Calendar
        </NavLink>
        <NavLink to="/reports" className={link}>
          <BarChart3 size={16} /> Workload
        </NavLink>
        <div className="flex items-center justify-between px-2.5 pt-5 pb-1 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
          Projects
          <button className="rounded p-0.5 hover:bg-slate-800 hover:text-white" title="New project" onClick={() => setCreating(true)}>
            <Plus size={14} />
          </button>
        </div>
        {projects.map((p) => (
          <NavLink key={p.id} to={`/p/${p.id}/board`} className={({ isActive }) => link({ isActive: isActive || location.pathname.startsWith(`/p/${p.id}/`) })}>
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
            <button className="rounded p-1 text-slate-400 hover:bg-slate-800 hover:text-white" title="Sign out" onClick={logout}>
              <LogOut size={16} />
            </button>
          )}
        </div>
      )}
      {creating && <NewProjectDialog onClose={() => setCreating(false)} />}
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

function ProjectPage() {
  const { projectId = '', view = 'board' } = useParams()
  const { data: project, error } = useProject(projectId)
  const del = useDeleteProject()
  const navigate = useNavigate()
  const modal = useTaskModal()
  if (error) return <Navigate to="/" replace />

  return (
    <Page
      title={project ? project.name : '…'}
      subtitle={project ? `${project.key} · ${project.task_count} tasks` : undefined}
      actions={
        <>
          <nav className="flex rounded-md border border-slate-300 bg-slate-50 p-0.5 text-sm">
            {VIEWS.map((v) => (
              <NavLink
                key={v.id}
                to={`/p/${projectId}/${v.id}${location.search}`}
                className={({ isActive }) => clsx('flex items-center gap-1.5 rounded px-3 py-1', isActive ? 'bg-white font-medium shadow-sm' : 'text-slate-600 hover:text-slate-900')}
              >
                <v.icon size={14} /> {v.label}
              </NavLink>
            ))}
          </nav>
          <Button variant="primary" onClick={() => modal.createTask({ title: '', project_id: projectId })}>
            <Plus size={14} /> Create
          </Button>
          <Button
            variant="ghost"
            title="Delete project"
            onClick={async () => {
              if (project && confirm(`Delete project ${project.name} and all ${project.task_count} tasks? This cannot be undone.`)) {
                await del.mutateAsync(project.id)
                navigate('/')
              }
            }}
          >
            <Trash2 size={16} />
          </Button>
        </>
      }
    >
      {view === 'timeline' ? <Gantt projectId={projectId} /> : view === 'calendar' ? <Calendar projectId={projectId} /> : <Board projectId={projectId} />}
    </Page>
  )
}

function Home() {
  const { data: projects, isLoading } = useProjects()
  if (isLoading) return null
  if (projects?.length) return <Navigate to={`/p/${projects[0].id}/board`} replace />
  return (
    <div className="flex h-full items-center justify-center p-6">
      <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <h1 className="text-xl font-semibold">Welcome to Open Planner</h1>
        <p className="mt-1 mb-4 text-sm text-slate-500">Create your first project to start planning tasks.</p>
        <NewProjectForm />
      </div>
    </div>
  )
}

function NewProjectDialog({ onClose }: { onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-slate-900/40 p-4 pt-[15vh]" onMouseDown={onClose}>
      <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-2xl" onMouseDown={(e) => e.stopPropagation()}>
        <h2 className="mb-4 text-lg font-semibold">New project</h2>
        <NewProjectForm onDone={onClose} />
      </div>
    </div>
  )
}

function NewProjectForm({ onDone }: { onDone?: () => void }) {
  const [name, setName] = useState('')
  const [key, setKey] = useState('')
  const [keyTouched, setKeyTouched] = useState(false)
  const [description, setDescription] = useState('')
  const create = useCreateProject()
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
    navigate(`/p/${p.id}/board`)
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
          Create project
        </Button>
      </div>
    </form>
  )
}
