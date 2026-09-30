import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { QueryClientProvider } from '@tanstack/react-query'
import App from './App'
import { initAuth } from './lib/auth'
import { queryClient } from './lib/queries'
import Login from './views/Login'
import './index.css'

const root = createRoot(document.getElementById('root')!)

initAuth()
  .then((authenticated) => {
    if (!authenticated) {
      root.render(<Login />)
      return
    }
    root.render(
      <StrictMode>
        <QueryClientProvider client={queryClient}>
          <BrowserRouter>
            <App />
          </BrowserRouter>
        </QueryClientProvider>
      </StrictMode>,
    )
  })
  .catch((err) => {
    console.error(err)
    root.render(
      <div style={{ padding: 32, fontFamily: 'system-ui' }}>
        <h1>Could not sign in</h1>
        <p>The identity provider is unreachable or misconfigured. Check the OIDC_* settings and try again.</p>
        <pre style={{ color: '#b91c1c' }}>{String(err?.message ?? err)}</pre>
      </div>,
    )
  })
