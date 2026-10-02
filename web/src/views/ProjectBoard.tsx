import { useMemo, useState } from 'react'
import clsx from 'clsx'
import { CheckCircle2, ChevronRight, Plus, Settings2 } from 'lucide-react'
import { EnvBadge } from '../components/Environments'
import { ProjectCategoriesDialog } from '../components/ProjectCategories'
import { ProjectProgress } from '../components/ProjectProgress'
import { useTaskModal } from '../components/TaskModal'
import { AvatarStack, Button, FilterBar, PriorityIcon, TypeBadge } from '../components/ui'
import { formatSchedule } from '../lib/dates'
import { useCategories, useTasks, useUpdateTask } from '../lib/queries'
import type { Task } from '../lib/types'

/**
 * Projects grouped by category (KPI, Enhancement, Ad Hoc, ...). A project's
 * status isn't set by hand: it comes from its tasks.
 */
export default function ProjectBoard({ workspaceId, assignee }: { workspaceId: string; assignee: string }) {
  const { data: all = [], isLoading } = useTasks({ workspace_id: workspaceId })
  const { data: categories = [] } = useCategories(workspaceId)
  const update = useUpdateTask()
  const modal = useTaskModal()
  const [editing, setEditing] = useState(false)
  const [dragId, setDragId] = useState<string | null>(null)
  const [over, setOver] = useState<string | null>(null)
  // Columns whose done projects are expanded; collapsed by default so finished work doesn't pile up.
  const [showDone, setShowDone] = useState<Set<string>>(new Set())
  const toggleDone = (id: string) =>
    setShowDone((prev) => {
      const next = new Set(prev)
      if (!next.delete(id)) next.add(id)
      return next
    })

  // Done/total over each project's daily and hourly tasks (two levels deep).
  const counts = useMemo(() => {
    const byParent = new Map<string, Task[]>()
    for (const t of all) if (t.parent_id) byParent.set(t.parent_id, [...(byParent.get(t.parent_id) ?? []), t])
    const m = new Map<string, { done: number; total: number }>()
    for (const p of all.filter((t) => t.type === 'project')) {
      const inside = (byParent.get(p.id) ?? []).flatMap((c) => [c, ...(byParent.get(c.id) ?? [])])
      m.set(p.id, { done: inside.filter((t) => t.status === 'done').length, total: inside.length })
    }
    return m
  }, [all])

  const projects = all.filter((t) => t.type === 'project' && (!assignee || t.assignee_ids.includes(assignee)))
  // Uncategorized comes first so projects still needing a category stand out.
  const columns = [{ id: '', name: 'Uncategorized', color: null }, ...categories.map((c) => ({ id: c.id, name: c.name, color: c.color }))]

  const drop = (categoryId: string) => {
    const p = projects.find((t) => t.id === dragId)
    setDragId(null)
    setOver(null)
    if (p && (p.project_category_id ?? '') !== categoryId) update.mutate({ id: p.id, patch: { project_category_id: categoryId || null } })
  }

  const card = (p: Task) => {
    const c = counts.get(p.id) ?? { done: 0, total: 0 }
    return (
      <div
        key={p.id}
        data-card
        draggable
        onDragStart={(e) => {
          e.dataTransfer.setData('text/plain', p.id)
          setDragId(p.id)
        }}
        onDragEnd={() => {
          setDragId(null)
          setOver(null)
        }}
        onClick={() => modal.openTask(p.id)}
        className={clsx(
          'cursor-pointer space-y-2 rounded-md border border-slate-200 bg-white p-2.5 shadow-sm transition hover:border-blue-300 hover:shadow',
          dragId === p.id && 'opacity-40',
        )}
      >
        <p className="text-sm leading-snug font-medium text-slate-800">{p.title}</p>
        <p className="text-[11px] text-slate-500">{formatSchedule({ ...p, type: 'daily' })}</p>
        <ProjectProgress project={p} done={c.done} total={c.total} />
        <div className="flex items-center gap-2">
          <TypeBadge type={p.type} kind={p.project_kind} />
          <span className="text-[11px] font-medium text-slate-500">{p.key}</span>
          <span className="ml-auto flex items-center gap-1.5">
            <PriorityIcon priority={p.priority} />
            <AvatarStack ids={p.assignee_ids} />
          </span>
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col gap-3">
      <FilterBar>
        <Button variant="ghost" onClick={() => setEditing(true)} title="Edit project categories">
          <Settings2 size={14} /> Categories
        </Button>
      </FilterBar>

      <div className="flex min-h-0 flex-1 gap-3 overflow-x-auto pb-1">
        {columns.map((col) => {
          const list = projects.filter((p) => (p.project_category_id ?? '') === col.id)
          if (!col.id && list.length === 0 && !dragId) return null
          const open = list.filter((p) => p.status !== 'done')
          const done = list.filter((p) => p.status === 'done')
          const expanded = showDone.has(col.id)
          return (
            <div
              key={col.id || 'none'}
              className={clsx('flex w-72 shrink-0 flex-col rounded-lg bg-slate-100 p-2', over === col.id && 'ring-2 ring-blue-400')}
              onDragOver={(e) => {
                if (!dragId) return
                e.preventDefault()
                setOver(col.id)
              }}
              onDragLeave={(e) => !e.currentTarget.contains(e.relatedTarget as Node) && setOver((o) => (o === col.id ? null : o))}
              onDrop={(e) => {
                e.preventDefault()
                drop(col.id)
              }}
            >
              <div className="mb-2 flex items-center justify-between px-1">
                <span className="flex items-center gap-2">
                  {col.id ? <EnvBadge name={col.name} color={col.color} /> : <span className="text-xs font-semibold tracking-wide text-slate-500 uppercase">Uncategorized</span>}
                  <span className="text-xs text-slate-400" title={`${open.length} open, ${done.length} done`}>
                    {open.length}
                  </span>
                </span>
                <button
                  className="rounded p-1 text-slate-500 hover:bg-slate-200"
                  title={`New ${col.id ? col.name : 'project'}`}
                  onClick={() => modal.createTask({ title: '', workspace_id: workspaceId, type: 'project', project_category_id: col.id || null })}
                >
                  <Plus size={14} />
                </button>
              </div>
              <div className="flex-1 space-y-2 overflow-y-auto">
                {isLoading && <div className="h-20 animate-pulse rounded-md bg-white/70" />}
                {open.map(card)}
                {!isLoading && open.length === 0 && (
                  <p className="px-1 py-6 text-center text-xs text-slate-400">{done.length ? 'No open projects' : 'No projects'}</p>
                )}
                {done.length > 0 && (
                  <button
                    type="button"
                    onClick={() => toggleDone(col.id)}
                    aria-expanded={expanded}
                    className="flex w-full items-center gap-1.5 rounded-md px-1.5 py-1 text-left text-xs font-medium text-slate-500 hover:bg-slate-200/70 hover:text-slate-700"
                  >
                    <ChevronRight size={13} className={clsx('transition-transform', expanded && 'rotate-90')} />
                    <CheckCircle2 size={13} className="text-emerald-500" />
                    {done.length} done
                  </button>
                )}
                {expanded && done.map(card)}
              </div>
            </div>
          )
        })}
      </div>
      <p className="text-[11px] text-slate-400">A project's status and progress come from the tasks inside it. Drag a project to change its category.</p>
      {editing && <ProjectCategoriesDialog workspaceId={workspaceId} onClose={() => setEditing(false)} />}
    </div>
  )
}
