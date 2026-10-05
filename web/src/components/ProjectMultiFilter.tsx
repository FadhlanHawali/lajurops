import { useEffect, useMemo, useRef, useState } from 'react'
import clsx from 'clsx'
import { FolderKanban, Search } from 'lucide-react'
import { colorForId, pillStyle } from '../lib/colors'
import type { Task } from '../lib/types'
import { Popover } from './Popover'
import { FilterTrigger } from './SearchSelect'

/** The "no project" choice: daily/hourly tasks that don't belong to a project. */
export const INDEPENDENT = 'none'

function score(p: Task, q: string): number {
  if (!q) return 1
  const key = p.key.toLowerCase()
  const title = p.title.toLowerCase()
  if (key.startsWith(q)) return 4
  if (title.startsWith(q)) return 3
  if (title.split(/\s+/).some((w) => w.startsWith(q))) return 2
  return title.includes(q) || key.includes(q) ? 1 : 0
}

/**
 * Pick any number of projects (plus "Independent tasks"), with search and
 * keyboard support. An empty selection means all projects.
 */
export function ProjectMultiFilter({
  value,
  onChange,
  projects,
  counts,
  footer,
}: {
  value: Set<string>
  onChange: (next: Set<string>) => void
  projects: Task[]
  /** Optional task count per project id (and INDEPENDENT) shown on each row. */
  counts?: Map<string, number>
  footer?: React.ReactNode
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const listRef = useRef<HTMLUListElement>(null)

  const q = query.trim().toLowerCase()
  const rows = useMemo(() => {
    const ranked = projects
      .map((p) => ({ p, s: score(p, q) }))
      .filter((r) => r.s > 0)
      .sort((a, b) => (q ? b.s - a.s : 0) || Number(a.p.status === 'done') - Number(b.p.status === 'done') || a.p.title.localeCompare(b.p.title))
      .map((r) => ({ id: r.p.id, label: r.p.title, sub: r.p.key, color: colorForId(r.p.id), done: r.p.status === 'done' }))
    const independent = { id: INDEPENDENT, label: 'Independent tasks', sub: 'no project', color: 'slate', done: false }
    return !q || 'independent tasks'.includes(q) ? [...ranked, independent] : ranked
  }, [projects, q])

  useEffect(() => setActive(0), [q])
  useEffect(() => {
    listRef.current?.querySelector(`[data-row="${active}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [active])

  const flip = (id: string) => {
    const next = new Set(value)
    if (!next.delete(id)) next.add(id)
    onChange(next)
  }
  const label =
    value.size === 0
      ? 'All projects'
      : value.size === 1
        ? value.has(INDEPENDENT)
          ? 'Independent tasks'
          : (projects.find((p) => value.has(p.id))?.title ?? '1 project')
        : `${value.size} projects`

  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        setOpen(o)
        if (o) setQuery('')
      }}
      trigger={(props, isOpen) => <FilterTrigger icon={FolderKanban} label={label} open={isOpen} active={value.size > 0} {...props} />}
    >
      <div className="w-80">
        <div className="flex items-center gap-2 border-b border-slate-100 px-3 py-2">
          <Search size={14} className="shrink-0 text-slate-400" />
          <input
            autoFocus
            className="w-full bg-transparent text-sm focus:outline-none"
            placeholder="Search projects…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') {
                e.preventDefault()
                setActive((a) => Math.min(a + 1, rows.length - 1))
              } else if (e.key === 'ArrowUp') {
                e.preventDefault()
                setActive((a) => Math.max(a - 1, 0))
              } else if (e.key === 'Enter' && rows[active]) {
                e.preventDefault()
                flip(rows[active].id)
              }
            }}
          />
        </div>
        <div className="flex items-center justify-between px-3 pt-1.5 text-[11px] text-slate-400">
          <span>{value.size ? `${value.size} selected` : 'Showing all'}</span>
          <span className="flex gap-2">
            <button type="button" className="font-medium text-blue-600 hover:underline" onClick={() => onChange(new Set([...value, ...rows.map((r) => r.id)]))}>
              Select {q ? 'matches' : 'all'}
            </button>
            <button type="button" className="font-medium text-blue-600 hover:underline" onClick={() => onChange(new Set())}>
              Clear
            </button>
          </span>
        </div>
        <ul ref={listRef} className="max-h-72 overflow-y-auto p-1" role="listbox" aria-multiselectable="true">
          {rows.map((r, i) => (
            <li
              key={r.id}
              data-row={i}
              role="option"
              aria-selected={value.has(r.id)}
              onMouseEnter={() => setActive(i)}
              onMouseDown={(e) => e.preventDefault()} // keep focus in the search box
              onClick={() => flip(r.id)}
              className={clsx('flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm', i === active && 'bg-blue-50')}
            >
              <input type="checkbox" readOnly tabIndex={-1} checked={value.has(r.id)} className="pointer-events-none" />
              <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={pillStyle(r.color, 1)} />
              <span className={clsx('min-w-0 flex-1 truncate', r.done ? 'text-slate-400 line-through' : 'text-slate-800')}>{r.label}</span>
              <span className="shrink-0 text-[11px] text-slate-400">
                {r.sub}
                {counts?.has(r.id) && ` · ${counts.get(r.id)}`}
              </span>
            </li>
          ))}
          {rows.length === 0 && <li className="px-2 py-3 text-center text-sm text-slate-400">No matching projects</li>}
        </ul>
        <div className="border-t border-slate-100 px-3 py-1.5 text-[11px] text-slate-400">{footer ?? '↑↓ to move · Enter to tick'}</div>
      </div>
    </Popover>
  )
}
