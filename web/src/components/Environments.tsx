import { useState } from 'react'
import clsx from 'clsx'
import { ChevronLeft, ChevronRight, Layers, Plus, X } from 'lucide-react'
import { useEnvironments, useSetEnvironments } from '../lib/queries'
import type { EnvColor, EnvironmentDraft } from '../lib/types'

const ENV_CLS: Record<EnvColor, { pill: string; dot: string }> = {
  slate: { pill: 'bg-slate-100 text-slate-700 ring-slate-300', dot: 'bg-slate-400' },
  green: { pill: 'bg-emerald-100 text-emerald-800 ring-emerald-300', dot: 'bg-emerald-500' },
  blue: { pill: 'bg-blue-100 text-blue-800 ring-blue-300', dot: 'bg-blue-500' },
  amber: { pill: 'bg-amber-100 text-amber-800 ring-amber-300', dot: 'bg-amber-500' },
  violet: { pill: 'bg-violet-100 text-violet-800 ring-violet-300', dot: 'bg-violet-500' },
  red: { pill: 'bg-red-100 text-red-700 ring-red-300', dot: 'bg-red-500' },
  teal: { pill: 'bg-teal-100 text-teal-800 ring-teal-300', dot: 'bg-teal-500' },
  pink: { pill: 'bg-pink-100 text-pink-700 ring-pink-300', dot: 'bg-pink-500' },
}
const COLORS = Object.keys(ENV_CLS) as EnvColor[]

const PRESETS: { name: string; color: EnvColor }[] = [
  { name: 'Dev', color: 'green' },
  { name: 'SIT', color: 'blue' },
  { name: 'UAT', color: 'amber' },
  { name: 'Staging', color: 'teal' },
  { name: 'Pilot', color: 'violet' },
  { name: 'Production', color: 'red' },
  { name: 'DR', color: 'pink' },
]
const STANDARD = ['Dev', 'UAT', 'Pilot', 'Production']

/** Picks a sensible colour for common environment names. */
export function guessColor(name: string, taken: EnvColor[] = []): EnvColor {
  const n = name.trim().toLowerCase()
  if (/^(dev|develop)/.test(n)) return 'green'
  if (/^(sit|test|qa)/.test(n)) return 'blue'
  if (/^uat/.test(n)) return 'amber'
  if (/^(stag|pre)/.test(n)) return 'teal'
  if (/^pilot/.test(n)) return 'violet'
  if (/^(prod|live)/.test(n)) return 'red'
  if (/^dr\b|disaster/.test(n)) return 'pink'
  return COLORS.find((c) => !taken.includes(c)) ?? 'slate'
}

export function EnvBadge({ name, color, size = 'sm', className }: { name: string; color: EnvColor | null; size?: 'xs' | 'sm'; className?: string }) {
  return (
    <span
      title={`Environment: ${name}`}
      className={clsx(
        'inline-flex max-w-32 shrink-0 items-center gap-1 truncate rounded font-semibold ring-1 ring-inset',
        ENV_CLS[color ?? 'slate'].pill,
        size === 'xs' ? 'px-1 py-px text-[9px] tracking-wide uppercase' : 'px-1.5 py-0.5 text-[11px]',
        className,
      )}
    >
      {name}
    </span>
  )
}

/**
 * Edits a project's environment list. Controlled: the caller decides whether
 * changes are saved immediately (existing project) or after creation.
 */
export function EnvironmentListEditor({ items, onChange, busy }: { items: EnvironmentDraft[]; onChange: (items: EnvironmentDraft[]) => void; busy?: boolean }) {
  const [name, setName] = useState('')
  const [editing, setEditing] = useState<number | null>(null)
  const [editName, setEditName] = useState('')
  const has = (n: string) => items.some((e) => e.name.toLowerCase() === n.trim().toLowerCase())

  const add = (n: string, color?: EnvColor) => {
    if (!n.trim() || has(n)) return
    onChange([...items, { id: '', name: n.trim(), color: color ?? guessColor(n, items.map((e) => e.color)) }])
  }
  const remove = (i: number) => {
    const e = items[i]
    if (e.task_count && !confirm(`Remove "${e.name}"? ${e.task_count} task(s) use it and will have no environment.`)) return
    onChange(items.filter((_, j) => j !== i))
  }
  const move = (i: number, d: -1 | 1) => {
    const j = i + d
    if (j < 0 || j >= items.length) return
    const next = [...items]
    ;[next[i], next[j]] = [next[j], next[i]]
    onChange(next)
  }
  const cycleColor = (i: number) => onChange(items.map((e, j) => (j === i ? { ...e, color: COLORS[(COLORS.indexOf(e.color) + 1) % COLORS.length] } : e)))
  const rename = (i: number) => {
    const n = editName.trim()
    setEditing(null)
    if (!n || n === items[i].name || items.some((e, j) => j !== i && e.name.toLowerCase() === n.toLowerCase())) return
    onChange(items.map((e, j) => (j === i ? { ...e, name: n } : e)))
  }

  const missingPresets = PRESETS.filter((p) => !has(p.name))

  return (
    <div className={clsx('space-y-2', busy && 'pointer-events-none opacity-70')}>
      {items.length > 0 ? (
        <ol className="flex flex-wrap items-center gap-1.5">
          {items.map((e, i) => (
            <li key={e.id || `new-${e.name}`} className={clsx('group flex items-center gap-1 rounded-md py-1 pr-1 pl-1.5 text-sm ring-1 ring-inset', ENV_CLS[e.color].pill)}>
              <span className="w-4 text-center text-[10px] font-medium opacity-50">{i + 1}</span>
              <button type="button" title="Change colour" onClick={() => cycleColor(i)} className={clsx('h-2.5 w-2.5 rounded-full', ENV_CLS[e.color].dot)} />
              {editing === i ? (
                <input
                  autoFocus
                  className="w-24 rounded bg-white px-1 text-sm text-slate-800 focus:outline-none"
                  value={editName}
                  onChange={(ev) => setEditName(ev.target.value)}
                  onBlur={() => rename(i)}
                  onKeyDown={(ev) => {
                    if (ev.key === 'Enter') rename(i)
                    if (ev.key === 'Escape') {
                      ev.preventDefault()
                      ev.stopPropagation()
                      setEditing(null)
                    }
                  }}
                />
              ) : (
                <button
                  type="button"
                  title="Rename"
                  className="font-semibold"
                  onClick={() => {
                    setEditing(i)
                    setEditName(e.name)
                  }}
                >
                  {e.name}
                </button>
              )}
              {!!e.task_count && <span className="text-[10px] opacity-60">{e.task_count}</span>}
              <span className="hidden items-center group-hover:flex">
                <button type="button" title="Move earlier" onClick={() => move(i, -1)} className="rounded p-0.5 hover:bg-white/60 disabled:opacity-30" disabled={i === 0}>
                  <ChevronLeft size={12} />
                </button>
                <button type="button" title="Move later" onClick={() => move(i, 1)} className="rounded p-0.5 hover:bg-white/60 disabled:opacity-30" disabled={i === items.length - 1}>
                  <ChevronRight size={12} />
                </button>
                <button type="button" title="Remove" onClick={() => remove(i)} className="rounded p-0.5 hover:bg-white/60">
                  <X size={12} />
                </button>
              </span>
            </li>
          ))}
        </ol>
      ) : (
        <p className="text-xs text-slate-400">No environments yet. Add the ones this project goes through, in order.</p>
      )}

      <div className="flex flex-wrap items-center gap-1.5">
        <div className="flex items-center gap-1 rounded-md border border-slate-300 bg-white px-2 py-0.5">
          <Plus size={12} className="text-slate-400" />
          <input
            className="w-36 bg-transparent py-0.5 text-sm focus:outline-none"
            placeholder="Add environment…"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
                e.preventDefault()
                add(name)
                setName('')
              }
            }}
          />
        </div>
        {items.length === 0 ? (
          <button
            type="button"
            onClick={() => onChange(STANDARD.map((n) => ({ id: '', name: n, color: guessColor(n) })))}
            className="rounded-full border border-dashed border-slate-300 px-2.5 py-0.5 text-xs font-medium text-slate-600 hover:border-slate-400 hover:bg-slate-50"
          >
            Use Dev → UAT → Pilot → Production
          </button>
        ) : (
          missingPresets.map((p) => (
            <button
              key={p.name}
              type="button"
              onClick={() => add(p.name, p.color)}
              className="rounded-full border border-dashed border-slate-300 px-2 py-0.5 text-[11px] font-medium text-slate-500 hover:border-slate-400 hover:bg-slate-50"
            >
              + {p.name}
            </button>
          ))
        )}
      </div>
    </div>
  )
}

/** Environment editor for an existing project; every change is saved right away. */
export function ProjectEnvironments({ projectId }: { projectId: string }) {
  const { data = [], isLoading } = useEnvironments(projectId)
  const save = useSetEnvironments(projectId)
  return (
    <section>
      <h3 className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-slate-700">
        <Layers size={15} /> Environments
      </h3>
      {isLoading ? <div className="h-8 animate-pulse rounded bg-slate-100" /> : <EnvironmentListEditor items={data} onChange={(list) => save.mutate(list)} busy={save.isPending} />}
      {save.error && <p className="mt-1 text-xs text-red-600">{save.error.message}</p>}
    </section>
  )
}

/** Environment choice for a daily/hourly task, from its project's list. */
export function EnvironmentPicker({ projectId, value, onChange }: { projectId?: string; value: string; onChange: (id: string) => void }) {
  const { data: envs = [], isLoading } = useEnvironments(projectId)
  if (!projectId) return <p className="text-xs text-slate-400">Link the task to a project to choose an environment.</p>
  if (isLoading) return <div className="h-7 animate-pulse rounded bg-slate-100" />
  if (envs.length === 0) return <p className="text-xs text-slate-400">This project has no environments yet. Add them on the project.</p>
  return (
    <div className="flex flex-wrap gap-1.5">
      <button
        type="button"
        onClick={() => onChange('')}
        className={clsx('rounded-md px-2 py-1 text-xs font-medium ring-1 ring-inset', !value ? 'bg-slate-800 text-white ring-slate-800' : 'text-slate-500 ring-slate-200 hover:bg-slate-50')}
      >
        None
      </button>
      {envs.map((e) => (
        <button
          key={e.id}
          type="button"
          onClick={() => onChange(e.id)}
          className={clsx(
            'flex items-center gap-1 rounded-md px-2 py-1 text-xs font-semibold ring-1 ring-inset transition',
            value === e.id ? clsx(ENV_CLS[e.color].pill, 'ring-2') : 'text-slate-600 ring-slate-200 hover:bg-slate-50',
          )}
        >
          <span className={clsx('h-2 w-2 rounded-full', ENV_CLS[e.color].dot)} />
          {e.name}
        </button>
      ))}
    </div>
  )
}
