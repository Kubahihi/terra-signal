import type { ReactNode } from 'react'

type IconName = 'globe' | 'external' | 'pin' | 'refresh' | 'download' | 'chevron' | 'arrow' | 'info' | 'target' | 'map' | 'calendar' | 'sun' | 'compare' | 'relationships' | 'leaf' | 'water'

export default function Icon({ name }: { name: IconName }) {
  const paths: Record<IconName, ReactNode> = {
    relationships: <><path d="M4 3v17h17" /><circle cx="8" cy="14" r="1.5" /><circle cx="12" cy="10" r="1.5" /><circle cx="17" cy="7" r="1.5" /><path d="m6 17 13-13" /></>,
    leaf: <><path d="M19 3C7 2 2 8 5 15s14 7 14-12Z" /><path d="M3 21 15 9m-7 7v-5m4 1h5" /></>,
    water: <path d="M12 2S5 10 5 15a7 7 0 0 0 14 0c0-5-7-13-7-13Zm-3 14c0 2 1 3 3 3" />,
    map: <><path d="m3 6 6-3 6 3 6-3v15l-6 3-6-3-6 3V6Zm6-3v15m6-12v15" /></>,
    calendar: <><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M7 3v4m10-4v4M3 11h18m-14 4h3m4 0h3m-10 3h3" /></>,
    sun: <><circle cx="12" cy="12" r="4" /><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5" /></>,
    compare: <><path d="M4 7h15m-4-4 4 4-4 4M20 17H5m4-4-4 4 4 4" /></>,
    globe: <><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3c5 5 5 13 0 18-5-5-5-13 0-18Z" /></>,
    external: <><path d="M13 4h7v7M20 4l-9 9M10 5H5v14h14v-5" /></>,
    pin: <><path d="M19 10c0 5-7 11-7 11S5 15 5 10a7 7 0 1 1 14 0Z" /><circle cx="12" cy="10" r="2.5" /></>,
    refresh: <><path d="M20 10a8 8 0 0 0-14-4L3 9m0-6v6h6M4 14a8 8 0 0 0 14 4l3-3m0 6v-6h-6" /></>,
    download: <><path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5" /></>,
    chevron: <path d="m7 10 5 5 5-5" />,
    arrow: <path d="M4 12h16m-6-6 6 6-6 6" />,
    info: <><circle cx="12" cy="12" r="9" /><path d="M12 11v6m0-10v.1" /></>,
    target: <><circle cx="12" cy="12" r="7" /><circle cx="12" cy="12" r="2" /><path d="M12 2v3m0 14v3M2 12h3m14 0h3" /></>,
  }
  return <svg className="icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>
}
