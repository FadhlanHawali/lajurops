export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    /** Server-side explanation, e.g. why a token was rejected. */
    public reason?: string,
  ) {
    super(reason ? `${message}: ${reason}` : message)
  }
}

/** Fired on window when the server rejects our credentials (HTTP 401). */
export const AUTH_ERROR_EVENT = 'lajurops:auth-error'

/**
 * Fired on window when the app loses its connection: detail "database" (the
 * server answers but can't reach its database), "server" (no answer at all)
 * or "auth" (the sign-in service, Keycloak, can't be reached).
 */
export const CONNECTION_EVENT = 'lajurops:connection'
export type ConnectionProblem = 'database' | 'server' | 'auth'
let lost: ConnectionProblem | null = null
export function connectionLost(problem: ConnectionProblem) {
  lost = problem
  window.dispatchEvent(new CustomEvent<ConnectionProblem>(CONNECTION_EVENT, { detail: problem }))
}
/** Called by the connection banner once everything answers again. */
export function connectionRestored() {
  lost = null
}

type TokenProvider = () => Promise<string | undefined>
let tokenProvider: TokenProvider | null = null

export function setTokenProvider(fn: TokenProvider) {
  tokenProvider = fn
}

type Query = Record<string, string | number | boolean | undefined | null>

export async function api<T>(
  path: string,
  opts: { method?: string; body?: unknown; query?: Query } = {},
): Promise<T> {
  const url = new URL('/api' + path, window.location.origin)
  for (const [k, v] of Object.entries(opts.query ?? {})) {
    if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v))
  }

  const headers: Record<string, string> = {}
  const token = await tokenProvider?.()
  if (token) headers.Authorization = `Bearer ${token}`
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json'

  let res: Response
  try {
    res = await fetch(url, {
      method: opts.method ?? 'GET',
      headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    })
  } catch {
    // No answer at all: the server is down or the network is.
    connectionLost('server')
    throw new ApiError('Can’t reach the LajurOps server', 0)
  }
  const data = await res.json().catch(() => null)
  if (!res.ok) {
    const err = new ApiError(data?.error ?? res.statusText, res.status, data?.reason)
    if (res.status === 503 && data?.code === 'database_unavailable') connectionLost('database')
    else if (res.status === 503 && data?.code === 'auth_unavailable') {
      console.error(`LajurOps can't check sign-ins: ${err.message}`)
      connectionLost('auth')
    }
    else if (res.status === 502 || res.status === 504) connectionLost('server') // a proxy in front had no server to ask
    // While Keycloak is down an expired session can't be renewed; that's what
    // the connection banner explains, not a token the server got wrong.
    if (res.status === 401 && lost !== 'auth') {
      console.error(`LajurOps API rejected the sign-in token (${opts.method ?? 'GET'} ${url.pathname}): ${err.message}`)
      window.dispatchEvent(new CustomEvent(AUTH_ERROR_EVENT, { detail: err.message }))
    }
    throw err
  }
  return data as T
}
