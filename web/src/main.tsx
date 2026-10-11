import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { QueryClientProvider } from '@tanstack/react-query'
import App from './App'
import { initAuth } from './lib/auth'
import { queryClient } from './lib/queries'
import Login from './views/Login'
import Unavailable from './views/Unavailable'
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
    root.render(<Unavailable error={err} />)
  })
