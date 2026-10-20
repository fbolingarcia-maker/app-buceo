// Agencias de certificación con las que trabaja un centro (PADI, SSI…)
export const AGENCIES = ['PADI', 'SSI', 'SDI/TDI', 'NAUI', 'RAID', 'CMAS', 'BSAC', 'IANTD']

export function Agencies({ list, small }) {
  if (!list?.length) return null
  return (
    <span className="agencies">
      {[...new Set(list.map((a) => a.toUpperCase()))].map((a) => <span key={a} className={'agency' + (small ? ' sm' : '')}>{a}</span>)}
    </span>
  )
}
