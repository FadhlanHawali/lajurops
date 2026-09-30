import Keycloak from 'keycloak-js'
import { setTokenProvider } from './api'

export interface AppConfig {
  auth_enabled: boolean
  keycloak_url: string
  keycloak_realm: string
  keycloak_clientId: string
  user_management: boolean
}

let keycloak: Keycloak | null = null
let config: AppConfig | null = null

export const appConfig = () => config!

/**
 * Loads runtime config from the backend and restores an existing Keycloak
 * session if there is one. Returns false when the user still has to sign in.
 */
export async function initAuth(): Promise<boolean> {
  config = await fetch('/api/config').then((r) => r.json())
  if (!config!.auth_enabled) return true

  const kc = new Keycloak({ url: config!.keycloak_url, realm: config!.keycloak_realm, clientId: config!.keycloak_clientId })
  const authenticated = await kc.init({ onLoad: 'check-sso', pkceMethod: 'S256', checkLoginIframe: false })
  keycloak = kc

  setTokenProvider(async () => {
    try {
      await kc.updateToken(30)
    } catch {
      // Session ended (expired or signed out elsewhere): back to the sign-in screen.
      window.location.reload()
    }
    return kc.token
  })
  return authenticated
}

export const authEnabled = () => keycloak !== null

export function login() {
  keycloak?.login()
}

export function logout() {
  keycloak?.logout({ redirectUri: window.location.origin })
}

/** Keycloak's self-service page (profile, password, sessions). */
export function accountUrl() {
  return keycloak?.createAccountUrl()
}
