import { useState } from 'react'
import clsx from 'clsx'
import { ArrowDownUp, Check, Search, X } from 'lucide-react'
import type { Task } from '../lib/types'
import { Popover } from './Popover'

export type ColumnSort = 'manual' | 'start_asc' | 'start_desc' | 'end_asc' | 'created_desc' | 'title'

const SORTS: { id: ColumnSort; label: string }[] = [
  { id: 'manual', label: 'Manual (drag to order)' },
  { id: 'start_asc', label: 'Start date: earliest first' },
  { id: 'start_desc', label: 'Start date: latest first' },
  { id: 'end_asc', label: 'End date: soonest first' },
  { id: 'created_desc', label: 'Created: newest first' },
  { id: 'title', label: 'Title A–Z' },
]

const time = (iso: string | null) => (iso ? new Date(iso).getTime() : null)

/** Undated tasks go last whichever way dates are sorted. */
function byDate(a: number | null, b: number | null, dir: 1 | -1) {
  if (a === null || b === null) return a === null ? (b === null ? 0 : 1) : -1
  return (a - b) * dir
}

const SORTERS: Record<ColumnSort, (a: Task, b: Task) => number> = {
  manual: (a, b) => a.position - b.position || a.number - b.number,
  start_asc: (a, b) => byDate(time(a.start_at), time(b.start_at), 1) || a.number - b.number,
  start_desc: (a, b) => byDate(time(a.start_at), time(b.start_at), -1) || a.number - b.number,
  end_asc: (a, b) => byDate(time(a.end_at ?? a.start_at), time(b.end_at ?? b.start_at), 1) || a.number - b.number,
  created_desc: (a, b) => b.created_at.localeCompare(a.created_at) || b.number - a.number,
  title: (a, b) => a.title.localeCompare(b.title) || a.number - b.number,
}

const storageKey = (scope: string) => `lajurops:column-sort:${scope}`

function loadSorts(scope: string): Record<string, ColumnSort> {
  try {
    const v = JSON.parse(localStorage.getItem(storageKey(scope)) ?? '{}')
    return v && typeof v === 'object' ? v : {}
  } catch {
    return {}
  }
}

export interface ColumnView {
  query: string
  setQuery: (q: string) => void
  sort: ColumnSort
  setSort: (s: ColumnSort) => void
  /** Filters by key/title and sorts; use for open and done lists alike. */
  apply: (list: Task[]) => Task[]
  manual: boolean
  filtering: boolean
  searchOpen: boolean
  setSearchOpen: (open: boolean) => void
}

/**
 * Search + sort state for each column of a board (scope e.g. "status" or
 * "category"). Sorts are remembered in this browser; searches are not.
 */
export function useColumnViews(scope: string): (columnId: string) => ColumnView {
  const [queries, setQueries] = useState<Record<string, string>>({})
  const [searchOpen, setSearchOpenState] = useState<Record<string, boolean>>({})
  const [sorts, setSorts] = useState<Record<string, ColumnSort>>(() => loadSorts(scope))

  return (id) => {
    const query = queries[id] ?? ''
    const sort = sorts[id] && sorts[id] in SORTERS ? sorts[id] : 'manual'
    const q = query.trim().toLowerCase()
    return {
      query,
      setQuery: (v) => setQueries((m) => ({ ...m, [id]: v })),
      sort,
      setSort: (v) =>
        setSorts((m) => {
          const next = { ...m, [id]: v }
          if (v === 'manual') delete next[id]
          try {
            localStorage.setItem(storageKey(scope), JSON.stringify(next))
          } catch {
            // storage unavailable: keep it for this page view only
          }
          return next
        }),
      apply: (list) => list.filter((t) => !q || t.title.toLowerCase().includes(q) || t.key.toLowerCase().includes(q)).sort(SORTERS[sort]),
      manual: sort === 'manual',
      filtering: q !== '',
      searchOpen: !!searchOpen[id] || q !== '',
      setSearchOpen: (v) => setSearchOpenState((m) => ({ ...m, [id]: v })),
    }
  }
}

/** Header buttons: search toggle and sort menu. */
export function ColumnToolButtons({ view }: { view: ColumnView }) {
  const [open, setOpen] = useState(false)
  const btn = 'rounded p-1 hover:bg-slate-200'
  return (
    <>
      <button
        type="button"
        className={clsx(btn, view.searchOpen ? 'text-blue-600' : 'text-slate-500')}
        title="Search this column"
        onClick={() => {
          if (view.searchOpen) view.setQuery('')
          view.setSearchOpen(!view.searchOpen)
        }}
      >
        <Search size={14} />
      </button>
      <Popover
        open={open}
        onOpenChange={setOpen}
        trigger={(props) => (
          <button
            type="button"
            {...props}
            className={clsx(btn, view.manual ? 'text-slate-500' : 'text-blue-600')}
            title={`Sort: ${SORTS.find((s) => s.id === view.sort)?.label}`}
          >
            <ArrowDownUp size={14} />
          </button>
        )}
      >
        <ul className="w-60 p-1 text-sm">
          {SORTS.map((s) => (
            <li key={s.id}>
              <button
                type="button"
                onClick={() => {
                  view.setSort(s.id)
                  setOpen(false)
                }}
                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-blue-50"
              >
                <span className="flex-1">{s.label}</span>
                {view.sort === s.id && <Check size={14} className="text-blue-600" />}
              </button>
            </li>
          ))}
        </ul>
      </Popover>
    </>
  )
}

/** The search box shown under a column header. */
export function ColumnSearch({ view }: { view: ColumnView }) {
  if (!view.searchOpen) return null
  const close = () => {
    view.setQuery('')
    view.setSearchOpen(false)
  }
  return (
    <div className="mb-2 flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-2 py-1 focus-within:border-blue-500 focus-within:ring-2 focus-within:ring-blue-500/20">
      <Search size={13} className="shrink-0 text-slate-400" />
      <input
        autoFocus
        className="min-w-0 flex-1 bg-transparent text-sm focus:outline-none"
        placeholder="Search by key or title…"
        value={view.query}
        onChange={(e) => view.setQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.stopPropagation()
            close()
          }
        }}
      />
      <button
        type="button"
        title="Clear and close"
        className="rounded p-0.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
        onClick={close}
      >
        <X size={13} />
      </button>
    </div>
  )
}
