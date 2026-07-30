// SPDX-License-Identifier: Apache-2.0
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router'

// Self-hosted fonts (no runtime Google Fonts request)
import '@fontsource/inter/400.css'
import '@fontsource/inter/500.css'
import '@fontsource/inter/600.css'
import '@fontsource/inter/700.css'
import '@fontsource/space-grotesk/500.css'
import '@fontsource/space-grotesk/600.css'
import '@fontsource/space-grotesk/700.css'
import '@fontsource/jetbrains-mono/400.css'
import '@fontsource/jetbrains-mono/500.css'
import '@fontsource/jetbrains-mono/600.css'

import './index.css'
import App from './App'
import { AuthProvider } from './auth/AuthContext'
import { BalancesProvider } from './hooks/useBalances'
import { initAnalytics, setStackVersion, EV, track } from './analytics'
import { STACK_VERSION } from './config'
import { getSession } from './auth/session'

// Theme is applied pre-paint by the inline no-flash script in index.html;
// useTheme() then owns it (OS-aware, persists on explicit override).

// Analytics is a no-op unless VITE_POSTHOG_KEY was set at build time, and
// posthog-js is a dynamic import inside initAnalytics, so nothing here delays
// the first render of the order book.
setStackVersion(STACK_VERSION)
initAnalytics()
track(EV.app_open, { signed_in: getSession() !== null })

ReactDOM.createRoot(document.getElementById('root')!).render(
  <BrowserRouter>
    <AuthProvider>
      <BalancesProvider>
        <App />
      </BalancesProvider>
    </AuthProvider>
  </BrowserRouter>
)
