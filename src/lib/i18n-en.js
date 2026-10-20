// Diccionario español -> inglés, repartido por zonas de la app
import core from './en/core'
import cuenta from './en/cuenta'
import buceador from './en/buceador'
import centro from './en/centro'
import verificacion from './en/verificacion'
import ux from './en/ux'
import seguridad from './en/seguridad'
import mfa from './en/mfa'
import diseno from './en/diseno'

export default { ...core, ...cuenta, ...buceador, ...centro, ...verificacion, ...ux, ...seguridad, ...mfa, ...diseno }
