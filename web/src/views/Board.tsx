import { useMemo, useState } from 'react'
import clsx from 'clsx'
import { ListTree, Plus } from 'lucide-react'
import { useTaskModal } from '../components/TaskModal'
import { Avatar, FilterBar, PriorityIcon, TypeBadge } from '../components/ui'
import { formatSchedule } from '../lib/dates'
import { useTaskFilters, useTasks, useUpdateTask, useUsers } from '../lib/queries'
import { STATUSES, type Status, type Task } from '../lib/types'

export default function Board({ projectId }: { projectId: string }) {
  const { assignee, type } = useTaskFilters()
  const [showSubtasks, setShowSubtasks] = useState(false)
  const { data: tasks = [], isLoading } = useTasks({ project_id: projectId, assignee_id: assignee, type, top_level: !showSubtasks })
  const update = useUpdateTask()
  const modal = useTaskModal()
  const [drag, setDrag] = useState<{ id: string; status: Status; index: number } | null>(null)

  const columns = useMemo(() => {
    const cols = Object.fromEntries(STATUSES.map((s) => [s.id, [] as Task[]])) as Record<Status, Task[]>
    for (const t of tasks) cols[t.status].push(t)
    for (const s of STATUSES) cols[s.id].sort((a, b) => a.position - b.position || a.number - b.number)
    return cols
  }, [tasks])

  const drop = (status: Status, index: number, id: string) => {
    const list = columns[status].filter((t) => t.id !== id)
    const before = list[index - 1]?.position
    const after = list[index]?.position
    const position =
      before === undefined && after === undefined ? 1 : before === undefined ? after! - 1 : after === undefined ? before + 1 : (before + after) / 2
    const task = tasks.find((t) => t.id === id)
    if (!task || (task.status === status && task.position === position)) return
    update.mutate({ id, patch: status === task.status ? { position } : { status, position } })
  }

  return (
    <div className="flex h-full flex-col gap-3">
      <FilterBar>
        <button
          onClick={() => setShowSubtasks((v) => !v)}
          className={clsx('inline-flex items-center gap-1 rounded-md border px-2.5 py-1 text-sm', showSubtasks ? 'border-slate-800 bg-slate-800 text-white' : 'border-slate-300 bg-white text-slate-600')}
        >
          <ListTree size={14} /> Subtasks as cards
        </button>
      </FilterBar>

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 overflow-x-auto md:grid-cols-4">
        {STATUSES.map((col) => {
          const items = columns[col.id]
          return (
            <div
              key={col.id}
              className={clsx('flex min-h-40 min-w-64 flex-col rounded-lg bg-slate-100 p-2', drag?.status === col.id && 'ring-2 ring-blue-400')}
              onDragOver={(e) => {
                e.preventDefault()
                if (drag && drag.status !== col.id && !(e.target as HTMLElement).closest('[data-card]')) setDrag({ ...drag, status: col.id, index: items.length })
              }}
              onDrop={(e) => {
                e.preventDefault()
                const id = e.dataTransfer.getData('text/task-id')
                if (id && drag) drop(col.id, drag.status === col.id ? drag.index : items.length, id)
                setDrag(null)
              }}
            >
              <div className="mb-2 flex items-center justify-between px-1">
                <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  {col.label} <span className="ml-1 text-slate-400">{items.length}</span>
                </span>
                <button className="rounded p-1 text-slate-500 hover:bg-slate-200" title="Create task" onClick={() => modal.createTask({ title: '', project_id: projectId, status: col.id })}>
                  <Plus size={14} />
                </button>
              </div>
              <div className="flex-1 space-y-2 overflow-y-auto">
                {isLoading && <div className="h-16 animate-pulse rounded-md bg-white/70" />}
                {items.map((t, i) => (
                  <div key={t.id}>
                    {drag?.status === col.id && drag.index === i && <DropMarker />}
                    <Card
                      task={t}
                      onOpen={() => modal.openTask(t.id)}
                      onDragStart={(e) => {
                        e.dataTransfer.setData('text/task-id', t.id)
                        e.dataTransfer.effectAllowed = 'move'
                        setDrag({ id: t.id, status: col.id, index: i })
                      }}
                      onDragOver={(e) => {
                        if (!drag) return
                        const r = e.currentTarget.getBoundingClientRect()
                        const index = e.clientY < r.top + r.height / 2 ? i : i + 1
                        if (drag.status !== col.id || drag.index !== index) setDrag({ ...drag, status: col.id, index })
                      }}
                      onDragEnd={() => setDrag(null)}
                    />
                  </div>
                ))}
                {drag?.status === col.id && drag.index >= items.length && <DropMarker />}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

const DropMarker = () => <div className="my-1 h-1 rounded bg-blue-500" />

function Card({
  task: t,
  onOpen,
  ...drag
}: {
  task: Task
  onOpen: () => void
  onDragStart: (e: React.DragEvent<HTMLDivElement>) => void
  onDragOver: (e: React.DragEvent<HTMLDivElement>) => void
  onDragEnd: () => void
}) {
  const { byId } = useUsers()
  return (
    <div
      data-card
      draggable
      {...drag}
      onClick={onOpen}
      className="cursor-pointer rounded-md border border-slate-200 bg-white p-2.5 shadow-sm transition hover:border-blue-300 hover:shadow"
    >
      <p className={clsx('text-sm leading-snug text-slate-800', t.status === 'done' && 'text-slate-400 line-through')}>{t.title}</p>
      <p className="mt-1 text-[11px] text-slate-500">{formatSchedule(t)}</p>
      {t.subtask_count > 0 && (
        <div className="mt-2 flex items-center gap-2">
          <div className="h-1 flex-1 overflow-hidden rounded bg-slate-100">
            <div className="h-full bg-emerald-500" style={{ width: `${(t.subtask_done / t.subtask_count) * 100}%` }} />
          </div>
          <span className="text-[11px] text-slate-500">
            {t.subtask_done}/{t.subtask_count}
          </span>
        </div>
      )}
      <div className="mt-2 flex items-center gap-2">
        <TypeBadge type={t.type} />
        <span className="text-[11px] font-medium text-slate-500">{t.key}</span>
        {t.parent_id && <span className="text-[10px] uppercase text-slate-400">subtask</span>}
        <span className="ml-auto flex items-center gap-1.5">
          <PriorityIcon priority={t.priority} />
          <Avatar user={t.assignee_id ? byId.get(t.assignee_id) : null} />
        </span>
      </div>
    </div>
  )
}
