import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import clsx from 'clsx'
import { AlertTriangle, CalendarRange, CircleCheck, CircleHelp, Folder, Loader2, Search, Server, Tag, User, X } from 'lucide-react'
import { dotStyle } from '../lib/colors'
import { formatSchedule } from '../lib/dates'
import { useSearch, useSearchByIds } from '../lib/queries'
import { recentTaskIds } from '../lib/recent'
import { statusLabel, type SearchResult, type SearchResults, type TaskType } from '../lib/types'
import { useTaskModal } from './TaskModal'
import { TypeBadge } from './ui'

const Ctx = createContext<{ openSearch: () => void }>({ openSearch: () => {} })

/** Opens the search palette (also on Ctrl+K / Cmd+K anywhere). */
export const useSearchPalette = () => useContext(Ctx)

export function SearchProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setOpen((o) => !o)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
  return (
    <Ctx.Provider value={{ openSearch: () => setOpen(true) }}>
      {children}
      {open && <SearchPalette onClose={() => setOpen(false)} />}
    </Ctx.Provider>
  )
}

const TYPE_ORDER: TaskType[] = ['project', 'daily', 'hourly']
const GROUP_LABEL: Record<TaskType, string> = { project: 'Projects', daily: 'Daily tasks', hourly: 'Hourly tasks' }
const FILTER_STYLE = {
  owner: { icon: User, cls: 'bg-blue-50 text-blue-700' },
  env: { icon: Server, cls: 'bg-amber-50 text-amber-800' },
  is: { icon: CircleCheck, cls: 'bg-emerald-50 text-emerald-700' },
  type: { icon: Tag, cls: 'bg-slate-100 text-slate-600' },
  in: { icon: Folder, cls: 'bg-orange-50 text-orange-800' },
  due: { icon: CalendarRange, cls: 'bg-violet-50 text-violet-700' },
} as const
const FILTER_PREFIX = { owner: '@', env: '#', is: 'is: ', type: 'type: ', in: 'in: ', due: '' } as const
const STATUS_CLS = { todo: 'bg-slate-100 text-slate-600', in_progress: 'bg-blue-50 text-blue-700', in_review: 'bg-amber-50 text-amber-800', done: 'bg-emerald-50 text-emerald-700' }

/** What each filter does, with examples you can click to try. */
const HELP: { kind: keyof typeof FILTER_STYLE | 'key' | 'words'; title: string; hint: string; examples: string[] }[] = [
  { kind: 'words', title: 'Words', hint: 'Match the title, in any order; small typos are fine.', examples: ['deploy production', 'relase notes'] },
  { kind: 'key', title: 'Task key', hint: 'Jumps straight to that task.', examples: ['APP-55', '55'] },
  { kind: 'owner', title: '@person', hint: 'Assigned to someone (username or name); @me is you.', examples: ['@me', '@alice deploy'] },
  { kind: 'env', title: '#environment', hint: 'Done in that environment.', examples: ['#prod', 'deploy #staging'] },
  { kind: 'is', title: 'is:open / is:done', hint: 'Not done yet, or done.', examples: ['is:open @me', 'migration is:done'] },
  { kind: 'type', title: 'type:', hint: 'project, daily or hourly.', examples: ['type:project', 'type:hourly #prod'] },
  { kind: 'in', title: 'in:project', hint: 'Inside a project whose name contains this.', examples: ['in:billing', 'in:portal type:daily'] },
  {
    kind: 'due',
    title: 'due:',
    hint: 'Scheduled in a period: today, tomorrow, this-week, last-week, next-week, this-month, a month (oct) or a date.',
    examples: ['due:this-week @me', 'deploy due:last-week', 'due:oct', 'due:2026-10-08'],
  },
]

function FilterHelp({ onTry }: { onTry: (q: string) => void }) {
  return (
    <div className="space-y-0.5 px-2.5 py-2">
      <p className="px-1 pb-1.5 text-xs text-slate-500">Combine words and filters in any order, e.g. <code className="rounded bg-slate-100 px-1">deploy @bob #prod due:this-week is:open</code>. Click an example to try it.</p>
      {HELP.map((h) => {
        const style = h.kind in FILTER_STYLE ? FILTER_STYLE[h.kind as keyof typeof FILTER_STYLE] : null
        return (
          <div key={h.title} className="grid grid-cols-[150px_minmax(0,1fr)] gap-3 rounded-md px-1.5 py-1.5 hover:bg-slate-50">
            <span className="flex items-start gap-1.5 pt-0.5 text-sm font-medium text-slate-700">
              {style ? <style.icon size={14} className="mt-0.5 shrink-0 text-slate-400" /> : <Search size={14} className="mt-0.5 shrink-0 text-slate-400" />}
              {h.title}
            </span>
            <span className="min-w-0">
              <span className="block text-xs text-slate-500">{h.hint}</span>
              <span className="mt-1 flex flex-wrap gap-1.5">
                {h.examples.map((ex) => (
                  <button
                    key={ex}
                    type="button"
                    className="rounded border border-slate-200 bg-white px-1.5 py-0.5 font-mono text-[11px] text-slate-700 hover:border-blue-300 hover:bg-blue-50 hover:text-blue-700"
                    onClick={() => onTry(ex)}
                    title="Search for this"
                  >
                    {ex}
                  </button>
                ))}
              </span>
            </span>
          </div>
        )
      })}
    </div>
  )
}

/** Highlights the query's words in a title. */
function Highlight({ text, words }: { text: string; words: string[] }) {
  const ws = words.filter((w) => w.length > 1)
  if (!ws.length) return <>{text}</>
  const re = new RegExp(`(${ws.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`, 'ig')
  return (
    <>
      {text.split(re).map((part, i) =>
        i % 2 ? (
          <mark key={i} className="rounded-sm bg-yellow-100 text-inherit">
            {part}
          </mark>
        ) : (
          part
        ),
      )}
    </>
  )
}

function SearchPalette({ onClose }: { onClose: () => void }) {
  const modal = useTaskModal()
  const [text, setText] = useState('')
  const [debounced, setDebounced] = useState('')
  const [sel, setSel] = useState(0)
  const [help, setHelp] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const t = setTimeout(() => setDebounced(text.trim()), 150)
    return () => clearTimeout(t)
  }, [text])

  const recentIds = useMemo(recentTaskIds, [])
  const searching = debounced !== ''
  const found = useSearch(debounced)
  const recent = useSearchByIds(recentIds, !searching)
  const data: SearchResults | undefined = searching ? found.data : recent.data
  const loading = searching ? found.isFetching && !found.data : recent.isLoading && recentIds.length > 0

  // Words to highlight: the query without its filters.
  const words = debounced.split(/\s+/).filter((w) => w && !/^[@#]|^[a-z]+:/i.test(w))
  // Results grouped by type; the group of the best match comes first.
  const groups = useMemo(() => {
    const results = data?.results ?? []
    if (!searching) return results.length ? [{ label: 'Recently opened', items: results }] : []
    const order = results.length ? [results[0].type, ...TYPE_ORDER.filter((t) => t !== results[0].type)] : TYPE_ORDER
    return order.map((type) => ({ label: GROUP_LABEL[type], type, items: results.filter((r) => r.type === type) })).filter((g) => g.items.length)
  }, [data, searching])
  const flat = groups.flatMap((g) => g.items)
  useEffect(() => setSel(0), [data])
  useEffect(() => {
    listRef.current?.querySelector(`[data-i="${sel}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [sel])

  const open = (r: SearchResult | undefined) => {
    if (!r) return
    onClose()
    modal.openTask(r.id)
  }
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      setSel((s) => Math.max(0, Math.min(flat.length - 1, s + (e.key === 'ArrowDown' ? 1 : -1))))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      if (!help) open(flat[sel])
    } else if (e.key === 'Escape') {
      // Close the filter help, then the palette (never a task dialog under it).
      e.preventDefault()
      e.stopPropagation()
      if (help) setHelp(false)
      else onClose()
    }
  }

  let i = 0
  return createPortal(
    <div className="fixed inset-0 z-[60] flex items-start justify-center bg-slate-900/40 p-4 pt-[10vh]" onMouseDown={onClose}>
      <div className="flex max-h-[75vh] w-full max-w-2xl flex-col overflow-hidden rounded-xl bg-white shadow-2xl" onMouseDown={(e) => e.stopPropagation()} role="dialog" aria-label="Search">
        <div className="flex items-center gap-2.5 border-b border-slate-200 px-4 py-3">
          <Search size={18} className="shrink-0 text-slate-400" />
          <input
            ref={inputRef}
            autoFocus
            className="min-w-0 flex-1 bg-transparent text-[15px] outline-none placeholder:text-slate-400"
            placeholder="Search by title or key…"
            value={text}
            onChange={(e) => {
              setText(e.target.value)
              setHelp(false)
            }}
            onKeyDown={onKeyDown}
            aria-label="Search tasks"
          />
          {searching && found.isFetching && <Loader2 size={15} className="animate-spin text-slate-400" />}
          <button className="rounded border border-slate-200 px-1.5 font-mono text-[11px] text-slate-500 hover:bg-slate-50" onClick={onClose}>
            Esc
          </button>
        </div>
        {searching && data && (data.filters.length > 0 || data.unknown.length > 0) && (
          <div className="flex flex-wrap items-center gap-1.5 px-4 pt-2.5">
            {data.filters.map((f, k) => {
              const s = FILTER_STYLE[f.kind]
              return (
                <span key={k} className={clsx('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium', s.cls)}>
                  <s.icon size={11} /> {FILTER_PREFIX[f.kind]}
                  {f.label}
                </span>
              )
            })}
            {data.unknown.length > 0 && (
              <span className="inline-flex items-center gap-1 text-[11px] text-amber-700" title="These look like filters but aren't, so they were ignored">
                <AlertTriangle size={11} /> Not a filter: {data.unknown.join(', ')}
              </span>
            )}
          </div>
        )}
        <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto px-1.5 pb-1.5">
          {help ? (
            <FilterHelp
              onTry={(q) => {
                setText(q)
                setDebounced(q)
                setHelp(false)
                inputRef.current?.focus()
              }}
            />
          ) : loading ? (
            <div className="flex justify-center p-6 text-slate-400">
              <Loader2 className="animate-spin" />
            </div>
          ) : flat.length === 0 ? (
            <p className="px-4 py-7 text-center text-sm text-slate-500">
              {searching ? 'No tasks match. Try fewer words or remove a filter.' : 'Search by title or key, e.g. APP-12 or "deploy". Tasks you open show up here.'}
            </p>
          ) : (
            groups.map((g) => (
              <div key={g.label}>
                <div className="flex items-center px-3 pt-3 pb-1 text-[11px] font-medium text-slate-400">
                  {g.label}
                  <span className="ml-auto tabular-nums">{g.items.length}</span>
                </div>
                {g.items.map((r) => {
                  const n = i++
                  return (
                    <button
                      key={r.id}
                      data-i={n}
                      type="button"
                      className={clsx('flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left', n === sel ? 'bg-blue-50' : 'hover:bg-slate-50')}
                      onMouseMove={() => n !== sel && setSel(n)}
                      onClick={() => open(r)}
                    >
                      <TypeBadge type={r.type} className="w-[68px] shrink-0 justify-center" />
                      <span className="min-w-0 flex-1">
                        <span className="flex items-baseline gap-2">
                          <span className="shrink-0 font-mono text-[11px] text-slate-400">{r.key}</span>
                          <span className={clsx('truncate text-sm font-medium', r.status === 'done' ? 'text-slate-400 line-through' : 'text-slate-800')}>
                            <Highlight text={r.title} words={words} />
                          </span>
                        </span>
                        <span className="block truncate text-[11px] text-slate-500">
                          {r.type === 'project' ? (r.category_name ?? r.workspace_key) : [r.workspace_key, ...r.path].join(' › ')} · {formatSchedule(r)}
                        </span>
                      </span>
                      {r.environment_name && (
                        <span className="flex shrink-0 items-center gap-1 text-[11px] text-slate-500">
                          <span className="h-2 w-2 rounded-full" style={dotStyle(r.environment_color)} />
                          {r.environment_name}
                        </span>
                      )}
                      <span className={clsx('shrink-0 rounded px-1.5 py-0.5 text-[11px] font-medium', STATUS_CLS[r.status])}>{statusLabel(r.status)}</span>
                    </button>
                  )
                })}
              </div>
            ))
          )}
        </div>
        <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 border-t border-slate-200 px-4 py-2 text-[11px] text-slate-500">
          <button
            type="button"
            className={clsx(
              'mr-0.5 inline-flex items-center gap-1 rounded px-1 py-0.5 font-medium',
              help ? 'bg-blue-50 text-blue-700' : 'text-slate-500 hover:bg-slate-100 hover:text-slate-700',
            )}
            onClick={() => {
              setHelp(!help)
              inputRef.current?.focus()
            }}
            title={help ? 'Back to results' : 'How to use filters'}
            aria-label={help ? 'Close filter help' : 'Show filter help'}
            aria-pressed={help}
          >
            {help ? <X size={13} /> : <CircleHelp size={13} />}
          </button>
          {[
            ['@alice', 'owner'],
            ['#prod', 'environment'],
            ['is:open', ''],
            ['type:daily', ''],
            ['in:billing', 'project'],
            ['due:this-week', ''],
          ].map(([k, hint]) => (
            <span key={k}>
              <code className="rounded bg-slate-100 px-1 text-slate-600">{k}</code>
              {hint && ` ${hint}`}
            </span>
          ))}
          <span className="ml-auto">
            {searching && data && `${data.results.length}${data.more ? '+' : ''} result${data.results.length === 1 ? '' : 's'} · `}
            <kbd className="font-mono">↑↓</kbd> move · <kbd className="font-mono">Enter</kbd> open
          </span>
        </div>
      </div>
    </div>,
    document.body,
  )
}
