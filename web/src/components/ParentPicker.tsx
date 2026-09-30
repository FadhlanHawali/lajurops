import { useEffect, useMemo, useRef, useState } from 'react'
import clsx from 'clsx'
import { CornerDownLeft, FolderKanban, Link2Off, Search } from 'lucide-react'
import { canContain, type Task, type TaskType } from '../lib/types'
import { Popover, TriggerButton } from './Popover'
import { StatusPill, TYPE_COLOR } from './ui'

const MAX_RESULTS = 30

/** Ranks a task against a query: key prefix > title prefix > word prefix > substring. */
export function matchScore(t: Task, q: string): number {
  const key = t.key.toLowerCase()
  const title = t.title.toLowerCase()
  if (key === q) return 100
  if (key.startsWith(q)) return 80
  if (title.startsWith(q)) return 60
  if (title.split(/\s+/).some((w) => w.startsWith(q))) return 40
  if (title.includes(q) || key.includes(q)) return 20
  return 0
}

/**
 * Picks the project (or, for hourly tasks, the daily task) a task belongs to.
 * Opening it lists only projects; daily tasks appear when searching, so the
 * list stays short in busy workspaces.
 */
export function ParentPicker({
  value,
  onChange,
  childType,
  containers,
  excludeId,
  disabled,
}: {
  value: string
  onChange: (id: string) => void
  /** Type of the task being edited; decides which parents are allowed. */
  childType: TaskType
  /** Project and daily tasks in the workspace. */
  containers: Task[]
  excludeId?: string
  disabled?: boolean
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const listRef = useRef<HTMLUListElement>(null)

  const byId = useMemo(() => new Map(containers.map((c) => [c.id, c])), [containers])
  const selected = value ? byId.get(value) : undefined
  const allowed = useMemo(() => containers.filter((c) => c.id !== excludeId && canContain(c.type, childType)), [containers, excludeId, childType])
  const searchesDaily = allowed.some((c) => c.type === 'daily')

  const results = useMemo(() => {
    const q = query.trim().toLowerCase()
    const openFirst = (a: Task, b: Task) => Number(a.status === 'done') - Number(b.status === 'done')
    if (!q) {
      // Browsing: projects only (open ones first), plus the current parent.
      const projects = allowed.filter((c) => c.type === 'project').sort((a, b) => openFirst(a, b) || a.title.localeCompare(b.title))
      if (selected && selected.type !== 'project') projects.unshift(selected)
      return projects
    }
    return allowed
      .map((c) => ({ c, s: matchScore(c, q) }))
      .filter((r) => r.s > 0)
      .sort((a, b) => b.s - a.s || openFirst(a.c, b.c) || Number(a.c.type !== 'project') - Number(b.c.type !== 'project') || a.c.title.localeCompare(b.c.title))
      .map((r) => r.c)
  }, [allowed, query, selected])
  const shown = results.slice(0, MAX_RESULTS)
  // Row 0 is "None (independent)"; results follow.
  const rows = shown.length + 1

  // While searching, highlight the best match so Enter picks it.
  useEffect(() => setActive(query.trim() && results.length ? 1 : 0), [query])
  useEffect(() => {
    listRef.current?.querySelector(`[data-row="${active}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [active])

  const pick = (id: string) => {
    onChange(id)
    setOpen(false)
  }

  const onOpenChange = (o: boolean) => {
    setOpen(o)
    if (o) {
      setQuery('')
      setActive(0)
    }
  }

  const projectOf = (t: Task) => (t.parent_id ? byId.get(t.parent_id) : undefined)

  return (
    <Popover
      open={open}
      onOpenChange={onOpenChange}
      matchWidth
      trigger={(props, isOpen) => (
        <TriggerButton
          icon={selected ? FolderKanban : Link2Off}
          placeholder={disabled ? 'Choose a workspace first' : 'None (independent)'}
          open={isOpen}
          onClear={() => onChange('')}
          disabled={disabled}
          {...props}
        >
          {selected && (
            <span className="flex min-w-0 flex-1 items-center gap-1.5 truncate pr-5">
              <span className="shrink-0 text-xs font-medium text-slate-400">{selected.key}</span>
              <span className="truncate font-medium text-slate-800">{selected.title}</span>
            </span>
          )}
        </TriggerButton>
      )}
    >
      <div className="w-full">
        <div className="flex items-center gap-2 border-b border-slate-100 px-3 py-2">
          <Search size={14} className="shrink-0 text-slate-400" />
          <input
            autoFocus
            className="w-full bg-transparent text-sm focus:outline-none"
            placeholder={searchesDaily ? 'Search projects and daily tasks…' : 'Search projects…'}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') {
                e.preventDefault()
                setActive((a) => Math.min(a + 1, rows - 1))
              } else if (e.key === 'ArrowUp') {
                e.preventDefault()
                setActive((a) => Math.max(a - 1, 0))
              } else if (e.key === 'Enter') {
                e.preventDefault()
                pick(active === 0 ? '' : shown[active - 1].id)
              }
            }}
          />
        </div>

        <ul ref={listRef} className="max-h-72 overflow-y-auto p-1">
          <Row index={0} active={active} setActive={setActive} onPick={() => pick('')} selected={!value}>
            <Link2Off size={14} className="shrink-0 text-slate-400" />
            <span className="text-slate-600">None (independent)</span>
          </Row>

          {shown.map((c, i) => {
            const project = c.type === 'daily' ? projectOf(c) : undefined
            return (
              <Row key={c.id} index={i + 1} active={active} setActive={setActive} onPick={() => pick(c.id)} selected={c.id === value}>
                <span className={clsx('h-2 w-2 shrink-0', TYPE_COLOR[c.type], c.type === 'project' ? 'rounded-sm' : 'rounded-full')} />
                <span className="w-16 shrink-0 text-xs font-medium text-slate-400">{c.key}</span>
                <span className="min-w-0 flex-1">
                  <span className={clsx('block truncate', c.status === 'done' ? 'text-slate-400 line-through' : 'text-slate-800')}>{c.title}</span>
                  {project && <span className="block truncate text-[11px] text-slate-400">in {project.title}</span>}
                </span>
                {c.type === 'daily' && <span className="shrink-0 text-[10px] font-medium text-sky-700 uppercase">Daily</span>}
                {c.status === 'done' && <StatusPill status="done" />}
              </Row>
            )
          })}
        </ul>

        <div className="border-t border-slate-100 px-3 py-1.5 text-[11px] text-slate-400">
          {query.trim()
            ? results.length === 0
              ? 'No matches'
              : results.length > MAX_RESULTS
                ? `Showing ${MAX_RESULTS} of ${results.length} matches — keep typing to narrow`
                : `${results.length} match${results.length === 1 ? '' : 'es'}`
            : results.length > MAX_RESULTS
              ? `Showing ${MAX_RESULTS} of ${results.length} projects — type to search`
              : searchesDaily
                ? 'Showing projects · type to find a daily task'
                : allowed.length === 0
                  ? 'No projects in this workspace yet'
                  : 'Type to search by key or title'}
          <span className="float-right flex items-center gap-1">
            ↑↓ <CornerDownLeft size={10} />
          </span>
        </div>
      </div>
    </Popover>
  )
}

function Row({
  index,
  active,
  setActive,
  onPick,
  selected,
  children,
}: {
  index: number
  active: number
  setActive: (i: number) => void
  onPick: () => void
  selected: boolean
  children: React.ReactNode
}) {
  return (
    <li
      data-row={index}
      role="option"
      aria-selected={selected}
      onMouseEnter={() => setActive(index)}
      onMouseDown={(e) => e.preventDefault()} // keep focus in the search box
      onClick={onPick}
      className={clsx(
        'flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm',
        index === active ? 'bg-blue-50' : '',
        selected && 'font-medium ring-1 ring-blue-200 ring-inset',
      )}
    >
      {children}
    </li>
  )
}
