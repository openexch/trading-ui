// SPDX-License-Identifier: Apache-2.0
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'

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

// Theme is applied pre-paint by the inline no-flash script in index.html;
// useTheme() then owns it (OS-aware, persists on explicit override).

ReactDOM.createRoot(document.getElementById('root')!).render(
  <BrowserRouter>
    <App />
  </BrowserRouter>
)
