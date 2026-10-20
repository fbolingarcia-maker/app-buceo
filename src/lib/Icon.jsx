// Iconos de línea (Lucide) con un único estilo: 18 px, trazo 1,75 y el color del texto.
// Uso: <Icon icon={MapPin} />. Si el icono va solo (sin texto al lado), pon aria-label en el botón o enlace que lo contiene.
export default function Icon({ icon: C, size = 18, className = '', ...rest }) {
  return <C size={size} strokeWidth={1.75} color="currentColor" aria-hidden="true" className={('ic ' + className).trim()} {...rest} />
}
