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

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <AuthProvider>
      <LangProvider>
        <App />
      </LangProvider>
    </AuthProvider>
  </React.StrictMode>
)
