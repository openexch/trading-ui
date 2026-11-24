// SPDX-License-Identifier: Apache-2.0
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router'

// Self-hosted fonts (no runtime font CDN request). Instrument Sans carries
// the interface and the numbers (tabular figures); Bricolage Grotesque is the
// display face for the wordmark and the ticker hero.
import '@fontsource/instrument-sans/400.css'
import '@fontsource/instrument-sans/500.css'
import '@fontsource/instrument-sans/600.css'
import '@fontsource/instrument-sans/700.css'
import '@fontsource/bricolage-grotesque/500.css'
import '@fontsource/bricolage-grotesque/600.css'
import '@fontsource/bricolage-grotesque/700.css'

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

const root = ReactDOM.createRoot(document.getElementById('root')!)

// Browser check page for the UI primitives, at ?check=primitives. Read once,
// never persisted, and split into its own chunk.
const params = new URLSearchParams(window.location.search)
if (params.get('check') === 'primitives') {
  import('./ui/check/PrimitivesCheck').then(({ PrimitivesCheck }) => {
    root.render(<PrimitivesCheck />)
  })
} else {
  root.render(
    <BrowserRouter>
      <AuthProvider>
        <BalancesProvider>
          <App />
        </BalancesProvider>
      </AuthProvider>
    </BrowserRouter>
  )
}
