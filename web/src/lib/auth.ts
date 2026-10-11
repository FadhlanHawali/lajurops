import Keycloak from 'keycloak-js'
import { connectionLost, setTokenProvider } from './api'

export interface AppConfig {
  auth_enabled: boolean
  keycloak_url: string
  keycloak_realm: string
  keycloak_clientId: string
  user_management: boolean
  /** Role of non-admins in workspaces nobody gave them a role in. */
  default_workspace_role: 'viewer' | 'none'
}

let keycloak: Keycloak | null = null
let config: AppConfig | null = null

export const appConfig = () => config!

/** Why the app can't start: the LajurOps server or Keycloak doesn't answer. */
export class Unavailable extends Error {
  constructor(public what: 'server' | 'auth') {
    super(what === 'server' ? 'The LajurOps server is unreachable' : 'The sign-in service (Keycloak) is unreachable')
  }
}

let probed: { at: number; ok: boolean } | null = null

/**
 * Whether the browser can reach Keycloak. An opaque (no-cors) request is
 * enough: it fails only when nothing answers. Cached for a few seconds, since
 * every API call may ask while a token can't be renewed.
 */
export async function keycloakReachable(fresh = false): Promise<boolean> {
  if (!config?.auth_enabled) return true
  if (!fresh && probed && Date.now() - probed.at < 3000) return probed.ok
  let ok = true
  try {
    await fetch(`${config.keycloak_url}/realms/${config.keycloak_realm}/.well-known/openid-configuration`, {
      mode: 'no-cors',
      cache: 'no-store',
      signal: AbortSignal.timeout(5000),
    })
  } catch {
    ok = false
  }
  probed = { at: Date.now(), ok }
  return ok
}

/**
 * Loads runtime config from the backend and restores an existing Keycloak
 * session if there is one. Returns false when the user still has to sign in.
 */
export async function initAuth(): Promise<boolean> {
  config = await fetch('/api/config').then(
    (r) => {
      if (!r.ok) throw new Unavailable('server')
      return r.json()
    },
    () => {
      throw new Unavailable('server')
    },
  )
  if (!config!.auth_enabled) return true
  // check-sso redirects to Keycloak; if it's down that would leave the app
  // for the browser's own error page.
  if (!(await keycloakReachable())) throw new Unavailable('auth')

  const kc = new Keycloak({ url: config!.keycloak_url, realm: config!.keycloak_realm, clientId: config!.keycloak_clientId })
  const authenticated = await kc.init({ onLoad: 'check-sso', pkceMethod: 'S256', checkLoginIframe: false })
  keycloak = kc

  setTokenProvider(async () => {
    try {
      await kc.updateToken(30)
    } catch {
      // Keycloak down: keep the token we have (it may still be valid) and
      // say what's wrong. Otherwise the session ended (expired or signed out
      // elsewhere): back to the sign-in screen.
      if (await keycloakReachable()) window.location.reload()
      else connectionLost('auth')
    }
    return kc.token
  })
  return authenticated
}

export const authEnabled = () => keycloak !== null

/** Goes to Keycloak's sign-in page; false (staying here) if it's down. */
export async function login(): Promise<boolean> {
  if (!(await keycloakReachable(true))) return false
  keycloak?.login()
  return true
}

export function logout() {
  keycloak?.logout({ redirectUri: window.location.origin })
}

/** Keycloak's self-service page (profile, password, sessions). */
export function accountUrl() {
  return keycloak?.createAccountUrl()
}
