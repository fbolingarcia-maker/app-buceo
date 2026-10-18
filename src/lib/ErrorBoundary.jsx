import { Component } from 'react'
import { t } from './i18n'

// Si una pantalla falla, muestra un aviso en vez de dejar la página en blanco
export default class ErrorBoundary extends Component {
  constructor(props) { super(props); this.state = { error: null } }
  static getDerivedStateFromError(error) { return { error } }
  componentDidCatch(error, info) { console.error('DiveSlot', error, info?.componentStack) }
  componentDidUpdate(prev) { if (prev.resetKey !== this.props.resetKey && this.state.error) this.setState({ error: null }) }
  render() {
    if (!this.state.error) return this.props.children
    return (
      <div className="card center" role="alert">
        <p style={{ marginTop: 0 }}><b>{t('Algo ha fallado en esta pantalla.')}</b></p>
        <p className="small muted">{t('Prueba a recargar. Si vuelve a pasar, escríbenos y cuéntanos qué estabas haciendo.')}</p>
        <div className="row" style={{ justifyContent: 'center', gap: 8 }}>
          <button type="button" className="btn small" onClick={() => window.location.reload()}>{t('Recargar')}</button>
          <a className="btn small ghost" href="#/">{t('Ir al inicio')}</a>
        </div>
      </div>
    )
  }
}
