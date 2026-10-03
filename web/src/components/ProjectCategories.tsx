import { useState } from 'react'
import clsx from 'clsx'
import { ArrowDown, ArrowUp, Plus, Trash2, X } from 'lucide-react'
import { PALETTE_NAMES } from '../lib/colors'
import { useCategories, useSetCategories } from '../lib/queries'
import type { EnvColor } from '../lib/types'
import { ColorPicker } from './ColorPicker'
import { Button } from './ui'

const PRESETS: { name: string; color: EnvColor }[] = [
  { name: 'KPI Project', color: 'violet' },
  { name: 'Enhancement Project', color: 'blue' },
  { name: 'Ad Hoc Project', color: 'amber' },
  { name: 'Maintenance Project', color: 'teal' },
  { name: 'Research Project', color: 'pink' },
]
const STARTER = ['KPI Project', 'Enhancement Project', 'Ad Hoc Project']

interface Item {
  id: string
  name: string
  color: EnvColor
  project_count?: number
}

/** Edit a workspace's project categories; changes save immediately. */
export function ProjectCategoriesDialog({ workspaceId, onClose }: { workspaceId: string; onClose: () => void }) {
  const { data = [], isLoading } = useCategories(workspaceId)
  const save = useSetCategories(workspaceId)
  const items: Item[] = data.map((c) => ({ id: c.id, name: c.name, color: c.color, project_count: c.project_count }))
  const [name, setName] = useState('')

  const commit = (list: Item[]) => save.mutate(list.map(({ id, name, color }) => ({ id, name, color })))
  const has = (n: string, except = -1) => items.some((c, i) => i !== except && c.name.toLowerCase() === n.trim().toLowerCase())
  const nextColor = (n: string) =>
    PRESETS.find((p) => p.name.toLowerCase() === n.trim().toLowerCase())?.color ?? PALETTE_NAMES.find((c) => c !== 'slate' && !items.some((i) => i.color === c)) ?? 'slate'

  const add = (n: string) => {
    if (!n.trim() || has(n)) return
    commit([...items, { id: '', name: n.trim(), color: nextColor(n) }])
  }
  const update = (i: number, patch: Partial<Item>) => commit(items.map((c, j) => (j === i ? { ...c, ...patch } : c)))
  const move = (i: number, d: -1 | 1) => {
    const next = [...items]
    ;[next[i], next[i + d]] = [next[i + d], next[i]]
    commit(next)
  }
  const remove = (i: number) => {
    const c = items[i]
    if (c.project_count && !confirm(`Remove "${c.name}"? ${c.project_count} project(s) use it and will become Uncategorized.`)) return
    commit(items.filter((_, j) => j !== i))
  }
  const missing = PRESETS.filter((p) => !has(p.name))

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-slate-900/40 p-4 pt-[12vh]" onMouseDown={onClose}>
      <div className="w-full max-w-lg rounded-xl bg-white shadow-2xl" onMouseDown={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3">
          <div>
            <h2 className="font-semibold">Project categories</h2>
            <p className="text-xs text-slate-500">The columns of the Projects board, in order. Click a name to rename it, or the colour to change it.</p>
          </div>
          <Button variant="ghost" onClick={onClose}>
            <X size={16} />
          </Button>
        </div>

        <div className={clsx('space-y-3 p-5', save.isPending && 'pointer-events-none opacity-70')}>
          {isLoading ? (
            <div className="h-24 animate-pulse rounded bg-slate-100" />
          ) : items.length === 0 ? (
            <p className="rounded-lg border border-dashed border-slate-300 px-3 py-4 text-center text-sm text-slate-500">
              No categories yet; every project is "Uncategorized".
            </p>
          ) : (
            <ul className="divide-y divide-slate-100 overflow-hidden rounded-lg border border-slate-200">
              {items.map((c, i) => (
                <Row
                  key={c.id || `new-${c.name}`}
                  item={c}
                  index={i}
                  last={i === items.length - 1}
                  taken={(n) => has(n, i)}
                  onRename={(n) => update(i, { name: n })}
                  onColor={(color) => update(i, { color })}
                  onMove={(d) => move(i, d)}
                  onRemove={() => remove(i)}
                />
              ))}
            </ul>
          )}

          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault()
              add(name)
              setName('')
            }}
          >
            <div className="flex flex-1 items-center gap-2 rounded-md border border-slate-300 bg-white px-2.5 focus-within:border-blue-500 focus-within:ring-2 focus-within:ring-blue-500/20">
              <Plus size={14} className="text-slate-400" />
              <input className="w-full bg-transparent py-1.5 text-sm focus:outline-none" placeholder="New category name…" value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <Button type="submit" variant="primary" disabled={!name.trim() || has(name)}>
              Add
            </Button>
          </form>
          {name.trim() && has(name) && <p className="-mt-1 text-xs text-red-600">A category with that name already exists.</p>}

          {items.length === 0 ? (
            <button
              type="button"
              onClick={() => commit(STARTER.map((n) => ({ id: '', name: n, color: PRESETS.find((p) => p.name === n)!.color })))}
              className="rounded-full border border-dashed border-slate-300 px-2.5 py-0.5 text-xs font-medium text-slate-600 hover:border-slate-400 hover:bg-slate-50"
            >
              Use KPI / Enhancement / Ad Hoc
            </button>
          ) : (
            missing.length > 0 && (
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-xs text-slate-400">Suggestions:</span>
                {missing.map((p) => (
                  <button
                    key={p.name}
                    type="button"
                    onClick={() => add(p.name)}
                    className="rounded-full border border-dashed border-slate-300 px-2 py-0.5 text-[11px] font-medium text-slate-500 hover:border-slate-400 hover:bg-slate-50"
                  >
                    + {p.name}
                  </button>
                ))}
              </div>
            )
          )}
          {save.error && <p className="text-xs text-red-600">{save.error.message}</p>}
        </div>
      </div>
    </div>
  )
}

function Row({
  item,
  index,
  last,
  taken,
  onRename,
  onColor,
  onMove,
  onRemove,
}: {
  item: Item
  index: number
  last: boolean
  taken: (name: string) => boolean
  onRename: (name: string) => void
  onColor: (color: EnvColor) => void
  onMove: (d: -1 | 1) => void
  onRemove: () => void
}) {
  const [draft, setDraft] = useState(item.name)
  const commitName = () => {
    const n = draft.trim()
    if (!n || n === item.name || taken(n)) return setDraft(item.name)
    onRename(n)
  }
  const icon = 'rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 disabled:pointer-events-none disabled:opacity-30'

  return (
    <li className="flex items-center gap-2.5 bg-white px-3 py-2">
      <span className="w-4 text-center text-xs font-medium text-slate-400 tabular-nums">{index + 1}</span>
      <ColorPicker value={item.color} onChange={onColor} />
      <input
        className="min-w-0 flex-1 rounded border border-transparent px-1.5 py-1 text-sm font-medium text-slate-800 hover:border-slate-200 focus:border-blue-500 focus:outline-none"
        value={draft}
        title="Rename"
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commitName}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur()
          if (e.key === 'Escape') {
            e.stopPropagation()
            setDraft(item.name)
            e.currentTarget.blur()
          }
        }}
      />
      <span className="w-20 shrink-0 text-right text-xs text-slate-400">
        {item.project_count ? `${item.project_count} project${item.project_count === 1 ? '' : 's'}` : 'unused'}
      </span>
      <span className="flex shrink-0 items-center">
        <button type="button" title="Move up" className={icon} disabled={index === 0} onClick={() => onMove(-1)}>
          <ArrowUp size={14} />
        </button>
        <button type="button" title="Move down" className={icon} disabled={last} onClick={() => onMove(1)}>
          <ArrowDown size={14} />
        </button>
        <button type="button" title="Remove" className={clsx(icon, 'hover:bg-red-50 hover:text-red-600')} onClick={onRemove}>
          <Trash2 size={14} />
        </button>
      </span>
    </li>
  )
}
