import { useMemo, useState } from 'react'
import clsx from 'clsx'
import { CheckCircle2, ChevronRight, Plus, Settings2 } from 'lucide-react'
import { EnvBadge } from '../components/Environments'
import { ProjectCategoriesDialog } from '../components/ProjectCategories'
import { ProjectProgress } from '../components/ProjectProgress'
import { useTaskModal } from '../components/TaskModal'
import { ColumnSearch, ColumnToolButtons, useColumnViews } from '../components/ColumnTools'
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
  // Where a dragged project would land: a category column and an index among its open projects.
  const [drag, setDrag] = useState<{ id: string; col: string; index: number } | null>(null)
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
  // When empty it only appears while dragging, as a drop target on the right:
  // adding it on the left would shift every card out from under the cursor,
  // and the browser cancels a drag whose source moves away at dragstart.
  const uncategorized = { id: '', name: 'Uncategorized', color: null }
  const hasUncategorized = projects.some((p) => !p.project_category_id)
  const columns = [
    ...(hasUncategorized ? [uncategorized] : []),
    ...categories.map((c) => ({ id: c.id, name: c.name, color: c.color })),
    ...(!hasUncategorized && drag ? [uncategorized] : []),
  ]

  const viewOf = useColumnViews('category')
  // Drag-to-reorder only makes sense in manual order with nothing filtered out.
  const reorderable = (col: string) => {
    const v = viewOf(col)
    return v.manual && !v.filtering
  }

  const openIn = (col: string) =>
    projects.filter((p) => (p.project_category_id ?? '') === col && p.status !== 'done').sort((a, b) => a.position - b.position || a.number - b.number)

  // Same ordering scheme as the task board: a position between the neighbours.
  const drop = () => {
    if (!drag) return
    const { id, col, index } = drag
    setDrag(null)
    const p = projects.find((t) => t.id === id)
    if (!p) return
    const moved = (p.project_category_id ?? '') !== col
    if (!moved && !reorderable(col)) return
    // index counts the dragged card itself; shift it once that card is taken out.
    const from = openIn(col).findIndex((t) => t.id === id)
    const at = from >= 0 && from < index ? index - 1 : index
    const list = openIn(col).filter((t) => t.id !== id)
    const before = list[at - 1]?.position
    const after = list[at]?.position
    const position =
      before === undefined && after === undefined ? 1 : before === undefined ? after! - 1 : after === undefined ? before + 1 : (before + after) / 2
    if (!moved && p.position === position) return
    update.mutate({ id, patch: moved ? { project_category_id: col || null, position } : { position } })
  }

  const card = (p: Task, col: string, index: number) => {
    const c = counts.get(p.id) ?? { done: 0, total: 0 }
    return (
      <div
        key={p.id}
        data-card
        draggable
        onDragStart={(e) => {
          e.dataTransfer.setData('text/plain', p.id)
          e.dataTransfer.effectAllowed = 'move'
          // Re-render after the browser has started the drag, not during dragstart.
          setTimeout(() => setDrag({ id: p.id, col, index }))
        }}
        onDragOver={(e) => {
          if (!drag) return
          // Done cards (index -1) and sorted/filtered columns can't be reordered; dropping there appends.
          const r = e.currentTarget.getBoundingClientRect()
          const at = index < 0 || !reorderable(col) ? openIn(col).length : e.clientY < r.top + r.height / 2 ? index : index + 1
          if (drag.col !== col || drag.index !== at) setDrag({ ...drag, col, index: at })
        }}
        onDragEnd={() => setDrag(null)}
        onClick={() => modal.openTask(p.id)}
        className={clsx(
          'cursor-pointer space-y-2 rounded-md border border-slate-200 bg-white p-2.5 shadow-sm transition hover:border-blue-300 hover:shadow',
          drag?.id === p.id && 'opacity-40',
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
          const view = viewOf(col.id)
          const list = projects.filter((p) => (p.project_category_id ?? '') === col.id)
          const allOpen = openIn(col.id)
          const allDone = list.filter((p) => p.status === 'done')
          // Search and sort apply to open and done projects alike.
          const open = view.apply(allOpen)
          const done = view.apply(allDone)
          // While searching, matching done projects show without an extra click.
          const expanded = showDone.has(col.id) || (view.filtering && done.length > 0)
          const marker = reorderable(col.id)
          return (
            <div
              key={col.id || 'none'}
              className={clsx('flex w-72 shrink-0 flex-col rounded-lg bg-slate-100 p-2', drag?.col === col.id && 'ring-2 ring-blue-400')}
              onDragOver={(e) => {
                if (!drag) return
                e.preventDefault()
                // Over empty space in another column: land at its end.
                if (drag.col !== col.id && !(e.target as HTMLElement).closest('[data-card]')) setDrag({ ...drag, col: col.id, index: allOpen.length })
              }}
              onDrop={(e) => {
                e.preventDefault()
                drop()
              }}
            >
              <div className="mb-2 flex items-center justify-between px-1">
                <span className="flex items-center gap-2">
                  {col.id ? <EnvBadge name={col.name} color={col.color} /> : <span className="text-xs font-semibold tracking-wide text-slate-500 uppercase">Uncategorized</span>}
                  <span className="text-xs text-slate-400" title={`${allOpen.length} open, ${allDone.length} done`}>
                    {view.filtering ? `${open.length} of ${allOpen.length}` : allOpen.length}
                  </span>
                </span>
                <span className="flex items-center">
                  <ColumnToolButtons view={view} />
                  <button
                    className="rounded p-1 text-slate-500 hover:bg-slate-200"
                    title={`New ${col.id ? col.name : 'project'}`}
                    onClick={() => modal.createTask({ title: '', workspace_id: workspaceId, type: 'project', project_category_id: col.id || null })}
                  >
                    <Plus size={14} />
                  </button>
                </span>
              </div>
              <ColumnSearch view={view} />
              <div className="flex-1 space-y-2 overflow-y-auto">
                {isLoading && <div className="h-20 animate-pulse rounded-md bg-white/70" />}
                {open.map((p, i) => (
                  <div key={p.id}>
                    {marker && drag?.col === col.id && drag.index === i && <DropMarker />}
                    {card(p, col.id, i)}
                  </div>
                ))}
                {marker && drag?.col === col.id && drag.index >= open.length && <DropMarker />}
                {!isLoading && open.length === 0 && (
                  <p className="px-1 py-6 text-center text-xs text-slate-400">
                    {view.filtering ? 'No matching open projects' : allDone.length ? 'No open projects' : 'No projects'}
                  </p>
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
                {expanded && done.map((p) => card(p, col.id, -1))}
              </div>
            </div>
          )
        })}
      </div>
      <p className="text-[11px] text-slate-400">A project's status and progress come from the tasks inside it. Drag projects to reorder them (in manual order) or change their category.</p>
      {editing && <ProjectCategoriesDialog workspaceId={workspaceId} onClose={() => setEditing(false)} />}
    </div>
  )
}

const DropMarker = () => <div className="my-1 h-1 rounded bg-blue-500" />
