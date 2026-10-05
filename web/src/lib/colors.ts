import type { CSSProperties } from 'react'

/**
 * Colours for environments and project categories: a named palette entry
 * ("violet") or any custom "#rrggbb". The first eight names are the
 * original set, so existing data keeps its look.
 */
export const PALETTE: Record<string, string> = {
  slate: '#64748b',
  green: '#10b981',
  blue: '#3b82f6',
  amber: '#f59e0b',
  violet: '#8b5cf6',
  red: '#ef4444',
  teal: '#14b8a6',
  pink: '#ec4899',
  orange: '#f97316',
  yellow: '#eab308',
  lime: '#84cc16',
  cyan: '#06b6d4',
  sky: '#0ea5e9',
  indigo: '#6366f1',
  purple: '#a855f7',
  fuchsia: '#d946ef',
  rose: '#f43f5e',
  stone: '#78716c',
}

export const PALETTE_NAMES = Object.keys(PALETTE)

const HEX = /^#[0-9a-f]{6}$/i

export const isHexColor = (c: string) => HEX.test(c)

/** The colour's base hex value (slate when unknown). */
export function hexOf(color: string | null | undefined): string {
  if (!color) return PALETTE.slate
  if (isHexColor(color)) return color.toLowerCase()
  return PALETTE[color] ?? PALETTE.slate
}

function mix(hex: string, with_: string, t: number): string {
  const p = (h: string, i: number) => parseInt(h.slice(i, i + 2), 16)
  const ch = (i: number) => Math.round(p(hex, i) * (1 - t) + p(with_, i) * t)
  return `#${[1, 3, 5].map((i) => ch(i).toString(16).padStart(2, '0')).join('')}`
}

/** Light tinted background, dark text and a soft ring, like Tailwind's 100/800/300 shades. */
export function pillStyle(color: string | null | undefined, ring = 1): CSSProperties {
  const c = hexOf(color)
  return { backgroundColor: mix(c, '#ffffff', 0.85), color: mix(c, '#000000', 0.5), boxShadow: `inset 0 0 0 ${ring}px ${mix(c, '#ffffff', ring > 1 ? 0.2 : 0.5)}` }
}

export const dotStyle = (color: string | null | undefined): CSSProperties => ({ backgroundColor: hexOf(color) })

/** The tinted chip colours (background, text, border) for a colour, for libraries that take plain values. */
export function tintColors(color: string | null | undefined): { bg: string; text: string; border: string } {
  const c = hexOf(color)
  return { bg: mix(c, '#ffffff', 0.85), text: mix(c, '#000000', 0.5), border: mix(c, '#ffffff', 0.2) }
}

/** A stable palette colour for something without one of its own (e.g. a project), from its id. */
export function colorForId(id: string): string {
  const names = PALETTE_NAMES.filter((n) => n !== 'slate')
  let h = 0
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0
  return names[Math.abs(h) % names.length]
}
