// Diccionario español -> inglés, repartido por zonas de la app
import core from './en/core'
import cuenta from './en/cuenta'
import buceador from './en/buceador'
import centro from './en/centro'
import verificacion from './en/verificacion'

export default { ...core, ...cuenta, ...buceador, ...centro, ...verificacion }
