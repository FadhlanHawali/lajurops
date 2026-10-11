import { useCallback, useEffect, useState } from 'react'
import { KeyRound, Loader2, ServerOff, TriangleAlert } from 'lucide-react'
import { keycloakReachable, Unavailable as Down } from '../lib/auth'

const RETRY_EVERY = 5000

const TEXT = {
  server: {
    icon: ServerOff,
    title: 'Can’t reach LajurOps',
    body: 'The LajurOps server isn’t answering. It may be restarting, or the network is down.',
  },
  auth: {
    icon: KeyRound,
    title: 'Sign-in is unavailable',
    body: 'LajurOps is running, but its sign-in service (Keycloak) isn’t answering, so you can’t sign in right now. If this lasts, ask your administrator to check Keycloak.',
  },
}

async function reachable(what: 'server' | 'auth') {
  if (what === 'auth') return keycloakReachable(true)
  return fetch('/api/config', { cache: 'no-store' }).then(
    (r) => r.ok,
    () => false,
  )
}

/**
 * Shown instead of the app when it can't start: the server or Keycloak is
 * down (it keeps trying and opens the app when they answer), or the sign-in
 * settings are wrong.
 */
export default function Unavailable({ error }: { error: unknown }) {
  const what = error instanceof Down ? error.what : null
  const [checking, setChecking] = useState(false)

  const retry = useCallback(async () => {
    if (!what) return window.location.reload()
    setChecking(true)
    if (await reachable(what)) window.location.reload()
    else setChecking(false)
  }, [what])

  useEffect(() => {
    if (!what) return
    const t = setInterval(retry, RETRY_EVERY)
    return () => clearInterval(t)
  }, [what, retry])

  const { icon: Icon, title, body } = what
    ? TEXT[what]
    : {
        icon: TriangleAlert,
        title: 'Could not sign in',
        body: 'The sign-in service (Keycloak) is misconfigured. Check the OIDC_* settings and try again.',
      }
  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 p-6">
      <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-8 shadow-sm">
        <div className="mb-6 flex items-center gap-2">
          <img src="/favicon.svg" className="h-7 w-7" alt="" />
          <span className="text-lg font-semibold tracking-tight text-slate-900">
            Lajur<span className="text-sky-500">Ops</span>
          </span>
        </div>
        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-red-50 text-red-600">
          <Icon size={20} />
        </div>
        <h1 className="mt-4 text-xl font-semibold text-slate-900">{title}</h1>
        <p className="mt-2 text-sm text-slate-600">{body}</p>
        {!what && <pre className="mt-4 overflow-x-auto rounded-md bg-red-50 p-3 text-xs whitespace-pre-wrap text-red-700">{String((error as Error)?.message ?? error)}</pre>}
        <div className="mt-6 flex items-center gap-3">
          <button
            onClick={retry}
            disabled={checking}
            className="inline-flex items-center gap-2 rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-70"
          >
            {checking && <Loader2 size={14} className="animate-spin" />}
            Try again
          </button>
          {what && <span className="text-xs text-slate-500">Trying again automatically…</span>}
        </div>
      </div>
    </div>
  )
}
