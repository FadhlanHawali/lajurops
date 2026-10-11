import { useCallback, useEffect, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { CircleCheck, DatabaseZap, Loader2, ServerOff } from 'lucide-react'
import { CONNECTION_EVENT, type ConnectionProblem } from '../lib/api'

const CHECK_EVERY = 3000

/** What /readyz says: fine, the database is out, or no server answers. */
async function check(): Promise<ConnectionProblem | null> {
  try {
    const res = await fetch('/readyz', { cache: 'no-store' })
    if (res.ok) return null
    const text = await res.text().catch(() => '')
    return text.includes('database') ? 'database' : 'server' // "shutting down": the server is restarting
  } catch {
    return 'server'
  }
}

/**
 * A banner while the app can't reach its server or database, so empty pages
 * have an explanation. It keeps checking, and when the connection is back it
 * says so and reloads what's on screen.
 */
export function ConnectionBanner() {
  const qc = useQueryClient()
  const [problem, setProblem] = useState<ConnectionProblem | null>(null)
  const [checking, setChecking] = useState(false)
  const [restored, setRestored] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)

  const recheck = useCallback(async () => {
    clearTimeout(timer.current)
    setChecking(true)
    const now = await check()
    setChecking(false)
    if (now) {
      setProblem(now)
      timer.current = setTimeout(recheck, CHECK_EVERY)
      return
    }
    setProblem(null)
    setRestored(true)
    qc.invalidateQueries() // fetch everything on screen again
    timer.current = setTimeout(() => setRestored(false), 4000)
  }, [qc])

  useEffect(() => {
    const on = (e: Event) => {
      const p = (e as CustomEvent<ConnectionProblem>).detail
      setRestored(false)
      setProblem((cur) => {
        // Start checking once per outage.
        if (!cur) {
          clearTimeout(timer.current)
          timer.current = setTimeout(recheck, CHECK_EVERY)
        }
        return cur === 'server' && p === 'database' ? 'database' : (cur ?? p)
      })
    }
    window.addEventListener(CONNECTION_EVENT, on)
    return () => {
      window.removeEventListener(CONNECTION_EVENT, on)
      clearTimeout(timer.current)
    }
  }, [recheck])

  // Floats at the top, above dialogs, so it's seen whatever is open.
  const box = 'fixed top-3 left-1/2 z-[90] flex w-[min(44rem,calc(100vw-2rem))] -translate-x-1/2 gap-2.5 rounded-lg border px-4 py-2.5 text-sm shadow-lg'
  if (restored)
    return (
      <div className={`${box} items-center border-emerald-200 bg-emerald-50 text-emerald-800`} role="status">
        <CircleCheck size={16} className="shrink-0" />
        <span>
          <b>Connected again.</b> Your data is up to date.
        </span>
      </div>
    )
  if (!problem) return null
  const Icon = problem === 'database' ? DatabaseZap : ServerOff
  return (
    <div className={`${box} items-start border-red-200 bg-red-50 text-red-800`} role="alert">
      <Icon size={16} className="mt-0.5 shrink-0" />
      <div className="min-w-0 flex-1">
        <b>{problem === 'database' ? 'Can’t connect to the database.' : 'Can’t reach the LajurOps server.'}</b>{' '}
        What you see may be out of date or empty, and changes won’t be saved until it’s back.
        <div className="text-xs text-red-700">
          {problem === 'database'
            ? 'The server is running but its database isn’t answering. If this lasts, ask your administrator to check the database.'
            : 'It may be restarting, or the network is down.'}{' '}
          Reconnecting automatically…
        </div>
      </div>
      <button className="flex shrink-0 items-center gap-1 text-xs font-medium underline disabled:no-underline" disabled={checking} onClick={recheck}>
        {checking && <Loader2 size={12} className="animate-spin" />}
        Retry now
      </button>
    </div>
  )
}
