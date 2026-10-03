import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import clsx from 'clsx'
import { Check, ChevronDown, CornerDownLeft, Search, type LucideIcon } from 'lucide-react'
import { Popover } from './Popover'

/** Compact trigger matching the filter bar's controls. */
export function FilterTrigger({ icon: Icon, label, open, active, ...props }: { icon: LucideIcon; label: ReactNode; open: boolean; active?: boolean } & Record<string, unknown>) {
  return (
    <button
      type="button"
      {...props}
      className={clsx(
        'flex max-w-72 items-center gap-1.5 rounded-md border bg-white px-2 py-1 text-sm transition',
        open ? 'border-blue-500 ring-2 ring-blue-500/20' : 'border-slate-300 hover:border-slate-400',
        active && 'font-medium text-blue-700',
      )}
    >
      <Icon size={14} className="shrink-0 text-slate-400" />
      <span className="min-w-0 truncate">{label}</span>
      <ChevronDown size={14} className="shrink-0 text-slate-400" />
    </button>
  )
}

export interface SearchOption {
  id: string
  /** Shown on the trigger when selected, and the default row content. */
  label: string
  /** Extra text to match besides the label (e.g. a key or username). */
  keywords?: string[]
  /** Custom row content. */
  row?: ReactNode
  /** Shown before the label on a "field" trigger, e.g. a colour dot. */
  icon?: ReactNode
  /** Fixed rows (e.g. "All …") sit on top and are hidden while searching. */
  fixed?: boolean
  /** Sorts below the others (e.g. done projects). */
  dimmed?: boolean
}

/** Ranks text against a query: prefix > word prefix > substring. */
function score(o: SearchOption, q: string): number {
  let best = 0
  for (const [i, raw] of [o.label, ...(o.keywords ?? [])].entries()) {
    const s = raw.toLowerCase()
    const bonus = i === 0 ? 1 : 0 // prefer label matches on ties
    if (s === q) best = Math.max(best, 100 + bonus)
    else if (s.startsWith(q)) best = Math.max(best, 80 + bonus)
    else if (s.split(/[\s._@-]+/).some((w) => w.startsWith(q))) best = Math.max(best, 40 + bonus)
    else if (s.includes(q)) best = Math.max(best, 20 + bonus)
  }
  return best
}

/** A filter dropdown with a search box and keyboard navigation. */
export function SearchSelect({
  value,
  onChange,
  options,
  icon,
  placeholder,
  noun,
  width = 'w-72',
  variant = 'filter',
}: {
  value: string
  onChange: (id: string) => void
  options: SearchOption[]
  icon: LucideIcon
  placeholder: string
  /** Plural noun for the footer, e.g. "projects". */
  noun: string
  width?: string
  /** "filter": compact filter-bar trigger; "field": full-width form input. */
  variant?: 'filter' | 'field'
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const listRef = useRef<HTMLUListElement>(null)

  const q = query.trim().toLowerCase()
  const searchable = options.filter((o) => !o.fixed)
  const rows = useMemo(() => {
    if (!q) return [...options.filter((o) => o.fixed), ...searchable.filter((o) => !o.dimmed), ...searchable.filter((o) => o.dimmed)]
    return searchable
      .map((o) => ({ o, s: score(o, q) }))
      .filter((r) => r.s > 0)
      .sort((a, b) => b.s - a.s || Number(!!a.o.dimmed) - Number(!!b.o.dimmed) || a.o.label.localeCompare(b.o.label))
      .map((r) => r.o)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [options, q])

  useEffect(() => setActive(0), [q])
  useEffect(() => {
    listRef.current?.querySelector(`[data-row="${active}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [active])

  const pick = (id: string) => {
    onChange(id)
    setOpen(false)
  }
  const selected = options.find((o) => o.id === value)

  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        setOpen(o)
        if (o) setQuery('')
      }}
      trigger={(props, isOpen) =>
        variant === 'field' ? (
          <button
            type="button"
            {...props}
            className={clsx(
              'flex w-full items-center gap-2 rounded-md border bg-white px-2.5 py-1.5 text-left text-sm shadow-sm transition',
              isOpen ? 'border-blue-500 ring-2 ring-blue-500/20' : 'border-slate-300 hover:border-slate-400',
            )}
          >
            {selected?.icon}
            <span className={clsx('min-w-0 flex-1 truncate', !selected?.id && 'text-slate-500')}>{selected?.label ?? placeholder}</span>
            <ChevronDown size={14} className="shrink-0 text-slate-400" />
          </button>
        ) : (
          <FilterTrigger icon={icon} label={selected?.label ?? placeholder} open={isOpen} active={!!value} {...props} />
        )
      }
      matchWidth={variant === 'field'}
    >
      <div className={variant === 'field' ? 'w-full' : width}>
        <div className="flex items-center gap-2 border-b border-slate-100 px-3 py-2">
          <Search size={14} className="shrink-0 text-slate-400" />
          <input
            autoFocus
            className="w-full bg-transparent text-sm focus:outline-none"
            placeholder={`Search ${noun}…`}
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
                pick(rows[active].id)
              }
            }}
          />
        </div>
        <ul ref={listRef} className="max-h-72 overflow-y-auto p-1">
          {rows.map((o, i) => (
            <li
              key={o.id || '__all'}
              data-row={i}
              role="option"
              aria-selected={o.id === value}
              onMouseEnter={() => setActive(i)}
              onMouseDown={(e) => e.preventDefault()} // keep focus in the search box
              onClick={() => pick(o.id)}
              className={clsx('flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm', i === active && 'bg-blue-50')}
            >
              {o.row ?? <span className={clsx('min-w-0 flex-1 truncate', o.fixed ? 'text-slate-600' : 'text-slate-800')}>{o.label}</span>}
              {o.id === value && <Check size={14} className="shrink-0 text-blue-600" />}
            </li>
          ))}
          {rows.length === 0 && <li className="px-2 py-3 text-center text-sm text-slate-400">No matching {noun}</li>}
        </ul>
        <div className="flex justify-between border-t border-slate-100 px-3 py-1.5 text-[11px] text-slate-400">
          <span>{q ? `${rows.length} match${rows.length === 1 ? '' : 'es'}` : `${searchable.length} ${noun} · type to search`}</span>
          <span className="flex items-center gap-1">
            ↑↓ <CornerDownLeft size={10} />
          </span>
        </div>
      </div>
    </Popover>
  )
}
