import React from 'react'
import { createRoot } from 'react-dom/client'
import { AuthProvider } from './lib/auth'
import { LangProvider } from './lib/i18n'
import App from './App'
// Fuentes del sistema de diseño, empaquetadas con la app (la CSP solo permite fuentes de 'self')
import '@fontsource/figtree/400.css'
import '@fontsource/figtree/500.css'
import '@fontsource/figtree/600.css'
import '@fontsource/figtree/700.css'
import '@fontsource/figtree/800.css'
import '@fontsource/barlow-condensed/600.css'
import './styles.css'

// Sin cobertura (barco, puerto): el service worker guarda la app para abrirla sin red. Solo en producción.
// «Instalar la app»: el navegador avisa una vez; se guarda para el botón de Perfil y Reservas
window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); window.__dsInstall = e; window.dispatchEvent(new Event('ds-install')) })

if (import.meta.env.PROD && 'serviceWorker' in navigator && window.location.pathname.startsWith('/app')) {
  window.addEventListener('load', () => navigator.serviceWorker.register('/app/sw.js', { scope: '/app/' }).catch(() => {}))
}

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <AuthProvider>
      <LangProvider>
        <App />
      </LangProvider>
    </AuthProvider>
  </React.StrictMode>
)
