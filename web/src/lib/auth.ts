import Keycloak from 'keycloak-js'
import { setTokenProvider } from './api'

interface AppConfig {
  auth_enabled: boolean
  keycloak_url: string
  keycloak_realm: string
  keycloak_clientId: string
}

let keycloak: Keycloak | null = null

/** Loads runtime config from the backend and, if enabled, logs in via Keycloak (PKCE). */
export async function initAuth(): Promise<void> {
  const cfg: AppConfig = await fetch('/api/config').then((r) => r.json())
  if (!cfg.auth_enabled) return

  const kc = new Keycloak({ url: cfg.keycloak_url, realm: cfg.keycloak_realm, clientId: cfg.keycloak_clientId })
  await kc.init({ onLoad: 'login-required', pkceMethod: 'S256', checkLoginIframe: false })
  keycloak = kc

  setTokenProvider(async () => {
    try {
      await kc.updateToken(30)
    } catch {
      await kc.login()
    }
    return kc.token
  })
}

export const authEnabled = () => keycloak !== null

export function logout() {
  keycloak?.logout({ redirectUri: window.location.origin })
}

export function accountUrl() {
  return keycloak?.createAccountUrl()
}
