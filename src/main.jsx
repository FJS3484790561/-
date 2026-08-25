import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

const isAdminSurface = window.location.pathname.startsWith('/admin')
const [{ default: App }] = await Promise.all(
  isAdminSurface
    ? [import('./AdminApp'), import('./admin-styles.css')]
    : [import('./App'), import('./styles.css')],
)

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
