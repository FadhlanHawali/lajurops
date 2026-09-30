import { useMemo, useState } from 'react'
import clsx from 'clsx'
import { AlertTriangle, CheckCircle2, Hourglass, Link2, Plus, Search, X } from 'lucide-react'
import { formatSchedule } from '../lib/dates'
import { useDependencyMutations } from '../lib/queries'
import type { Task } from '../lib/types'
import { matchScore } from './ParentPicker'
import { Popover } from './Popover'
import { StatusPill, TYPE_COLOR, TypeBadge } from './ui'

/**
 * "Waiting for" and "Blocking" lists for a daily/hourly task, e.g.
 * "Create VM" waits for "Create IP".
 */
export function Dependencies({
  task,
  waitingFor,
  blocking,
  candidates,
  onOpen,
}: {
  task: Task
  waitingFor: Task[]
  blocking: Task[]
  /** Daily/hourly tasks in the workspace. */
  candidates: Task[]
  onOpen: (id: string) => void
}) {
  const { add, remove } = useDependencyMutations()
  const [error, setError] = useState('')
  const open = waitingFor.filter((t) => t.status !== 'done')

  const run = async (p: Promise<unknown>) => {
    setError('')
    try {
      await p
    } catch (e) {
      setError((e as Error).message)
    }
  }

  // Can't link to itself or to tasks already linked in either direction.
  const linked = new Set([task.id, ...waitingFor.map((t) => t.id), ...blocking.map((t) => t.id)])
  const available = candidates.filter((c) => !linked.has(c.id))
  // Suggest tasks with the same parent (e.g. other steps of the same project).
  const siblings = available.filter((c) => task.parent_id && c.parent_id === task.parent_id && c.status !== 'done')

  return (
    <section className="space-y-3">
      <h3 className="flex items-center gap-1.5 text-sm font-semibold text-slate-700">
        <Link2 size={15} /> Dependencies
      </h3>

      {open.length > 0 && task.status !== 'done' && (
        <div className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          <Hourglass size={14} className="mt-px shrink-0" />
          <span>
            Waiting for {open.length} task{open.length === 1 ? '' : 's'} that {open.length === 1 ? "isn't" : "aren't"} done yet:{' '}
            {open.map((t, i) => (
              <span key={t.id}>
                {i > 0 && ', '}
                <button className="font-semibold hover:underline" onClick={() => onOpen(t.id)}>
                  {t.key}
                </button>
              </span>
            ))}
          </span>
        </div>
      )}

      <DependencyList
        title="Waiting for"
        empty="Not waiting for anything"
        items={waitingFor}
        onOpen={onOpen}
        conflict={(t) => !!(t.status !== 'done' && t.end_at && task.start_at && Date.parse(t.end_at) > Date.parse(task.start_at))}
        conflictText="finishes after this task starts"
        onRemove={(t) => run(remove.mutateAsync({ taskId: task.id, dependsOnId: t.id }))}
        picker={
          <TaskSearch
            label="Add a task this is waiting for"
            options={available}
            suggestions={siblings}
            onPick={(t) => run(add.mutateAsync({ taskId: task.id, dependsOnId: t.id }))}
          />
        }
      />

      <DependencyList
        title="Blocking"
        empty="No tasks are waiting for this one"
        items={blocking}
        onOpen={onOpen}
        conflict={(t) => !!(task.status !== 'done' && task.end_at && t.start_at && Date.parse(task.end_at) > Date.parse(t.start_at))}
        conflictText="starts before this task finishes"
        onRemove={(t) => run(remove.mutateAsync({ taskId: t.id, dependsOnId: task.id }))}
        picker={
          <TaskSearch
            label="Add a task that waits for this"
            options={available}
            suggestions={siblings}
            onPick={(t) => run(add.mutateAsync({ taskId: t.id, dependsOnId: task.id }))}
          />
        }
      />

      {error && <p className="text-xs text-red-600">{error}</p>}
    </section>
  )
}

function DependencyList({
  title,
  empty,
  items,
  onOpen,
  onRemove,
  conflict,
  conflictText,
  picker,
}: {
  title: string
  empty: string
  items: Task[]
  onOpen: (id: string) => void
  onRemove: (t: Task) => void
  conflict: (t: Task) => boolean
  conflictText: string
  picker: React.ReactNode
}) {
  return (
    <div>
      <div className="mb-1 flex items-center justify-between">
        <span className="text-xs font-medium tracking-wide text-slate-500 uppercase">{title}</span>
        {picker}
      </div>
      {items.length === 0 ? (
        <p className="text-xs text-slate-400">{empty}</p>
      ) : (
        <ul className="divide-y divide-slate-100 rounded-md border border-slate-200">
          {items.map((t) => (
            <li key={t.id} className="group flex items-center gap-2 px-2 py-1.5 text-sm hover:bg-slate-50">
              {t.status === 'done' ? <CheckCircle2 size={14} className="shrink-0 text-emerald-500" /> : <Hourglass size={14} className="shrink-0 text-amber-500" />}
              <button className="text-xs font-medium text-blue-600 hover:underline" onClick={() => onOpen(t.id)}>
                {t.key}
              </button>
              <button className={clsx('min-w-0 flex-1 truncate text-left', t.status === 'done' && 'text-slate-400 line-through')} onClick={() => onOpen(t.id)}>
                {t.title}
              </button>
              {conflict(t) && (
                <span className="flex shrink-0 items-center gap-1 text-[11px] text-red-600" title={`Schedule conflict: ${conflictText}`}>
                  <AlertTriangle size={12} /> {conflictText}
                </span>
              )}
              <TypeBadge type={t.type} />
              <StatusPill status={t.status} />
              <button className="rounded p-0.5 text-slate-300 opacity-0 group-hover:opacity-100 hover:bg-slate-200 hover:text-slate-600" title="Remove dependency" onClick={() => onRemove(t)}>
                <X size={14} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

const MAX_RESULTS = 30

/** Small "+" button that searches tasks by key or title. */
function TaskSearch({ label, options, suggestions, onPick }: { label: string; options: Task[]; suggestions: Task[]; onPick: (t: Task) => void }) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)

  const results = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return suggestions.slice(0, 8)
    return options
      .map((t) => ({ t, s: matchScore(t, q) }))
      .filter((r) => r.s > 0)
      .sort((a, b) => b.s - a.s || Number(a.t.status === 'done') - Number(b.t.status === 'done') || a.t.number - b.t.number)
      .map((r) => r.t)
  }, [query, options, suggestions])
  const shown = results.slice(0, MAX_RESULTS)

  const pick = (t: Task) => {
    onPick(t)
    setOpen(false)
  }

  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        setOpen(o)
        if (o) {
          setQuery('')
          setActive(0)
        }
      }}
      trigger={(props) => (
        <button type="button" {...props} className="flex items-center gap-1 rounded px-1.5 py-0.5 text-xs font-medium text-blue-600 hover:bg-blue-50">
          <Plus size={12} /> {label}
        </button>
      )}
    >
      <div className="w-96">
        <div className="flex items-center gap-2 border-b border-slate-100 px-3 py-2">
          <Search size={14} className="shrink-0 text-slate-400" />
          <input
            autoFocus
            className="w-full bg-transparent text-sm focus:outline-none"
            placeholder="Search daily/hourly tasks by key or title…"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value)
              setActive(0)
            }}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') {
                e.preventDefault()
                setActive((a) => Math.min(a + 1, shown.length - 1))
              } else if (e.key === 'ArrowUp') {
                e.preventDefault()
                setActive((a) => Math.max(a - 1, 0))
              } else if (e.key === 'Enter' && shown[active]) {
                e.preventDefault()
                pick(shown[active])
              }
            }}
          />
        </div>
        {!query.trim() && shown.length > 0 && <p className="px-3 pt-2 text-[11px] font-medium tracking-wide text-slate-400 uppercase">In the same project</p>}
        <ul className="max-h-64 overflow-y-auto p-1">
          {shown.map((t, i) => (
            <li
              key={t.id}
              role="option"
              aria-selected={i === active}
              onMouseEnter={() => setActive(i)}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => pick(t)}
              className={clsx('flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm', i === active && 'bg-blue-50')}
            >
              <span className={clsx('h-2 w-2 shrink-0 rounded-full', TYPE_COLOR[t.type])} />
              <span className="w-16 shrink-0 text-xs font-medium text-slate-400">{t.key}</span>
              <span className="min-w-0 flex-1">
                <span className={clsx('block truncate', t.status === 'done' ? 'text-slate-400 line-through' : 'text-slate-800')}>{t.title}</span>
                <span className="block truncate text-[11px] text-slate-400">{formatSchedule(t)}</span>
              </span>
            </li>
          ))}
        </ul>
        <p className="border-t border-slate-100 px-3 py-1.5 text-[11px] text-slate-400">
          {query.trim()
            ? results.length === 0
              ? 'No matches'
              : results.length > MAX_RESULTS
                ? `Showing ${MAX_RESULTS} of ${results.length} — keep typing`
                : `${results.length} match${results.length === 1 ? '' : 'es'}`
            : 'Type to search all daily and hourly tasks in this workspace'}
        </p>
      </div>
    </Popover>
  )
}
