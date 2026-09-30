import { useMemo, useState } from 'react'
import clsx from 'clsx'
import { Check, Search, Users } from 'lucide-react'
import { useMe, useUsers } from '../lib/queries'
import { Popover, TriggerButton } from './Popover'
import { Avatar, userName } from './ui'

/** Picks any number of owners. The current user is offered first. */
export function MultiUserPicker({ value, onChange, placeholder = 'Unassigned' }: { value: string[]; onChange: (ids: string[]) => void; placeholder?: string }) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const { users, byId } = useUsers()
  const me = useMe().data

  const options = useMemo(() => {
    const q = query.trim().toLowerCase()
    const list = users.filter((u) => !q || userName(u).toLowerCase().includes(q) || u.username.includes(q) || u.email.toLowerCase().includes(q))
    // Me first, then selected, then everyone else alphabetically.
    const rank = (id: string) => (id === me?.id ? 0 : value.includes(id) ? 1 : 2)
    return list.sort((a, b) => rank(a.id) - rank(b.id) || userName(a).localeCompare(userName(b)))
  }, [users, query, value, me])

  const toggle = (id: string) => onChange(value.includes(id) ? value.filter((v) => v !== id) : [...value, id])
  const selected = value.map((id) => byId.get(id)).filter((u) => !!u)

  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        setOpen(o)
        if (o) setQuery('')
      }}
      matchWidth
      trigger={(props, isOpen) => (
        <TriggerButton icon={Users} placeholder={placeholder} open={isOpen} onClear={() => onChange([])} {...props}>
          {selected.length > 0 && (
            <span className="flex min-w-0 flex-1 flex-wrap items-center gap-1 pr-5">
              {selected.map((u) => (
                <span key={u.id} className="inline-flex items-center gap-1 rounded-full bg-slate-100 py-0.5 pr-2 pl-0.5 text-xs font-medium text-slate-700">
                  <Avatar user={u} />
                  {userName(u)}
                </span>
              ))}
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
            placeholder="Search people…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && options[0]) {
                e.preventDefault()
                toggle(options[0].id)
                setQuery('')
              }
            }}
          />
        </div>
        <ul className="max-h-64 overflow-y-auto p-1">
          {options.map((u) => {
            const on = value.includes(u.id)
            return (
              <li
                key={u.id}
                role="option"
                aria-selected={on}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => toggle(u.id)}
                className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-blue-50"
              >
                <span className={clsx('flex h-4 w-4 shrink-0 items-center justify-center rounded border', on ? 'border-blue-600 bg-blue-600 text-white' : 'border-slate-300')}>
                  {on && <Check size={12} strokeWidth={3} />}
                </span>
                <Avatar user={u} />
                <span className="min-w-0 flex-1 truncate">
                  {userName(u)} {u.id === me?.id && <span className="text-xs text-slate-400">(you)</span>}
                </span>
                <span className="truncate text-xs text-slate-400">{u.email}</span>
              </li>
            )
          })}
          {options.length === 0 && <li className="px-2 py-3 text-center text-sm text-slate-400">No one matches</li>}
        </ul>
        <div className="border-t border-slate-100 px-3 py-1.5 text-[11px] text-slate-400">
          {value.length} selected · click to toggle · Enter adds the top match
        </div>
      </div>
    </Popover>
  )
}
