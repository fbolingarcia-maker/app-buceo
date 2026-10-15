import React from 'react'
import { createRoot } from 'react-dom/client'
import { AuthProvider } from './lib/auth'
import App from './App'
import './styles.css'

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <AuthProvider>
      <App />
    </AuthProvider>
  </React.StrictMode>
)
