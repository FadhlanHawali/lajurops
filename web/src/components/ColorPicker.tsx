import { useState } from 'react'
import clsx from 'clsx'
import { Check } from 'lucide-react'
import { dotStyle, hexOf, isHexColor, PALETTE, PALETTE_NAMES } from '../lib/colors'
import { Popover } from './Popover'

/** A colour swatch button that opens a palette with a custom colour option. */
export function ColorPicker({ value, onChange, size = 'md' }: { value: string; onChange: (color: string) => void; size?: 'sm' | 'md' }) {
  const [open, setOpen] = useState(false)
  const [hex, setHex] = useState(hexOf(value))
  const pick = (c: string) => {
    onChange(c)
    setOpen(false)
  }
  const custom = isHexColor(value)

  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        setOpen(o)
        if (o) setHex(hexOf(value))
      }}
      trigger={(props) => (
        <button
          type="button"
          title="Change colour"
          {...props}
          className={clsx(
            'shrink-0 rounded-full ring-2 ring-white ring-offset-1 ring-offset-slate-200 transition hover:ring-offset-slate-400',
            size === 'sm' ? 'h-3 w-3' : 'h-5 w-5',
          )}
          style={dotStyle(value)}
        />
      )}
    >
      <div className="w-56 space-y-3 p-3">
        <div className="grid grid-cols-6 gap-2">
          {PALETTE_NAMES.map((name) => (
            <button
              key={name}
              type="button"
              title={name}
              onClick={() => pick(name)}
              className="flex h-7 w-7 items-center justify-center rounded-full transition hover:scale-110"
              style={{ backgroundColor: PALETTE[name] }}
            >
              {value === name && <Check size={14} className="text-white" strokeWidth={3} />}
            </button>
          ))}
        </div>
        <div className="border-t border-slate-100 pt-3">
          <div className="mb-1.5 text-[11px] font-semibold tracking-wide text-slate-500 uppercase">Custom</div>
          <div className="flex items-center gap-2">
            <label className={clsx('relative h-7 w-7 shrink-0 cursor-pointer overflow-hidden rounded-full', custom && 'ring-2 ring-blue-500 ring-offset-1')} style={{ backgroundColor: hex }}>
              <input type="color" className="absolute inset-0 cursor-pointer opacity-0" value={hex} onChange={(e) => setHex(e.target.value)} onBlur={() => isHexColor(hex) && hex !== hexOf(value) && onChange(hex)} />
            </label>
            <input
              className={clsx('w-24 rounded-md border px-2 py-1 font-mono text-xs focus:outline-none', isHexColor(hex) ? 'border-slate-300 focus:border-blue-500' : 'border-red-400')}
              value={hex}
              maxLength={7}
              onChange={(e) => setHex(e.target.value.startsWith('#') ? e.target.value : `#${e.target.value}`)}
              onKeyDown={(e) => e.key === 'Enter' && isHexColor(hex) && pick(hex.toLowerCase())}
            />
            <button
              type="button"
              disabled={!isHexColor(hex)}
              onClick={() => pick(hex.toLowerCase())}
              className="rounded-md bg-slate-800 px-2 py-1 text-xs font-medium text-white hover:bg-slate-700 disabled:opacity-40"
            >
              Use
            </button>
          </div>
        </div>
      </div>
    </Popover>
  )
}
