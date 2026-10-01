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

  const res = await fetch(url, {
    method: opts.method ?? 'GET',
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  })
  const data = await res.json().catch(() => null)
  if (!res.ok) {
    const err = new ApiError(data?.error ?? res.statusText, res.status, data?.reason)
    if (res.status === 401) {
      console.error(`LajurOps API rejected the sign-in token (${opts.method ?? 'GET'} ${url.pathname}): ${err.message}`)
      window.dispatchEvent(new CustomEvent(AUTH_ERROR_EVENT, { detail: err.message }))
    }
    throw err
  }
  return data as T
}
