// シンプルな線画アイコン群。すべて currentColor で色を継承する。
// 「介護」「監視」「見守り」を想起させる意匠（カメラ、GPS、通知バッジ等）は使用しない。

interface IconProps {
  size?: number
}

export function HomeIcon({ size = 24 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M3.5 11L12 4l8.5 7"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M5.5 9.5V19a1 1 0 0 0 1 1H9a1 1 0 0 0 1-1v-4a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v4a1 1 0 0 0 1 1h2.5a1 1 0 0 0 1-1V9.5"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

export function CalendarIcon({ size = 24 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="3.5" y="5" width="17" height="15.5" rx="2.5" stroke="currentColor" strokeWidth={2} />
      <path d="M7.5 3v4M16.5 3v4" stroke="currentColor" strokeWidth={2} strokeLinecap="round" />
      <path d="M3.5 10h17" stroke="currentColor" strokeWidth={2} />
    </svg>
  )
}

export function BagIcon({ size = 24 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M6.5 8.5h11l1 12a1.5 1.5 0 0 1-1.5 1.6H7a1.5 1.5 0 0 1-1.5-1.6l1-12Z"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinejoin="round"
      />
      <path d="M9 8.5V7a3 3 0 0 1 6 0v1.5" stroke="currentColor" strokeWidth={2} strokeLinecap="round" />
    </svg>
  )
}

export function MicIcon({ size = 40 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="9" y="2.5" width="6" height="12" rx="3" fill="white" />
      <path d="M6 11v1.5a6 6 0 0 0 12 0V11" stroke="white" strokeWidth={2.2} strokeLinecap="round" />
      <path d="M12 18.5v3" stroke="white" strokeWidth={2.2} strokeLinecap="round" />
      <path d="M8.5 21.5h7" stroke="white" strokeWidth={2.2} strokeLinecap="round" />
    </svg>
  )
}

export function StopIcon({ size = 44 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="5" y="5" width="14" height="14" rx="3" fill="white" />
    </svg>
  )
}

export function MenuIcon({ size = 24 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M3.5 6.5h17M3.5 12h17M3.5 17.5h17" stroke="currentColor" strokeWidth={2} strokeLinecap="round" />
    </svg>
  )
}

export function BellIcon({ size = 24 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M6 10.5a6 6 0 0 1 12 0c0 4 1.5 5.5 1.5 5.5H4.5S6 14.5 6 10.5Z"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinejoin="round"
      />
      <path d="M10 19a2 2 0 0 0 4 0" stroke="currentColor" strokeWidth={2} strokeLinecap="round" />
    </svg>
  )
}

export function SearchIcon({ size = 24 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="10.5" cy="10.5" r="6.5" stroke="currentColor" strokeWidth={2} />
      <path d="M19.5 19.5 15.5 15.5" stroke="currentColor" strokeWidth={2} strokeLinecap="round" />
    </svg>
  )
}

export function PlusIcon({ size = 22 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" />
    </svg>
  )
}

export function ChevronRightIcon({ size = 18 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M9 5l7 7-7 7" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

export function ChevronLeftIcon({ size = 20 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M15 5l-7 7 7 7" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

export function SunIcon({ size = 22 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="4.5" fill="currentColor" />
      <path
        d="M12 2.5v2.4M12 19.1v2.4M4.6 4.6l1.7 1.7M17.7 17.7l1.7 1.7M2.5 12h2.4M19.1 12h2.4M4.6 19.4l1.7-1.7M17.7 6.3l1.7-1.7"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
      />
    </svg>
  )
}

export function LocationPinIcon({ size = 20 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M12 21s7-6.2 7-11.5A7 7 0 0 0 5 9.5C5 14.8 12 21 12 21Z"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinejoin="round"
      />
      <circle cx="12" cy="9.5" r="2.4" stroke="currentColor" strokeWidth={2} />
    </svg>
  )
}

export function ClipboardIcon({ size = 20 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="5" y="4.5" width="14" height="16" rx="2.2" stroke="currentColor" strokeWidth={2} />
      <path d="M9 4.5V3.5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v1" stroke="currentColor" strokeWidth={2} />
      <path d="M8.5 11h7M8.5 15h7" stroke="currentColor" strokeWidth={2} strokeLinecap="round" />
    </svg>
  )
}

export function BusIcon({ size = 20 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="4" y="4.5" width="16" height="12" rx="2.5" stroke="currentColor" strokeWidth={2} />
      <path d="M4 10.5h16" stroke="currentColor" strokeWidth={2} />
      <path d="M7 19.5v1.3M17 19.5v1.3" stroke="currentColor" strokeWidth={2} strokeLinecap="round" />
      <circle cx="7.8" cy="16.5" r="0.9" fill="currentColor" />
      <circle cx="16.2" cy="16.5" r="0.9" fill="currentColor" />
    </svg>
  )
}

export function TaxiIcon({ size = 20 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M5.5 15.5 6.8 9.8a2 2 0 0 1 2-1.6h6.4a2 2 0 0 1 2 1.6l1.3 5.7"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinejoin="round"
      />
      <rect x="4" y="15" width="16" height="4.5" rx="1.5" stroke="currentColor" strokeWidth={2} />
      <path d="M9.5 5.5h5" stroke="currentColor" strokeWidth={2} strokeLinecap="round" />
      <circle cx="7.5" cy="19.8" r="1" fill="currentColor" />
      <circle cx="16.5" cy="19.8" r="1" fill="currentColor" />
    </svg>
  )
}

export function HospitalIcon({ size = 22 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="4.5" y="8" width="15" height="12.5" rx="1.5" stroke="currentColor" strokeWidth={1.8} />
      <path d="M9 20.5V16a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v4.5" stroke="currentColor" strokeWidth={1.8} />
      <path d="M12 10v4M10 12h4" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" />
    </svg>
  )
}

export function PackageIcon({ size = 22 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M12 3.5 20 7.8v8.4L12 20.5 4 16.2V7.8L12 3.5Z"
        stroke="currentColor"
        strokeWidth={1.8}
        strokeLinejoin="round"
      />
      <path d="M4 7.8 12 12l8-4.2M12 12v8.5" stroke="currentColor" strokeWidth={1.8} strokeLinejoin="round" />
    </svg>
  )
}

export function ForkKnifeIcon({ size = 22 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M7 3v7.5a1.5 1.5 0 0 0 3 0V3M8.5 10.5V21" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" />
      <path d="M5.5 3v4.5M9.5 3v4.5" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" />
      <path
        d="M16.5 3c-1.4 0-2.5 1.8-2.5 4s1 3.6 2 4v10"
        stroke="currentColor"
        strokeWidth={1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

export function ScissorsIcon({ size = 22 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="6.5" cy="6.5" r="2.3" stroke="currentColor" strokeWidth={1.8} />
      <circle cx="6.5" cy="17.5" r="2.3" stroke="currentColor" strokeWidth={1.8} />
      <path d="M8.3 8 20 19M8.3 16 20 5" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" />
    </svg>
  )
}

export function WalkIcon({ size = 22 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="13.5" cy="4.2" r="1.8" fill="currentColor" />
      <path
        d="M10.5 8 8 12l2.5 1.5-1 5.5M13.5 8l1.8 3.2L18 13l-2 2.5.8 3.8M10.5 8h4.5l1.5 2.3"
        stroke="currentColor"
        strokeWidth={1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

export function MoonIcon({ size = 22 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M19.5 14.5A8 8 0 1 1 9.5 4.5a6.3 6.3 0 0 0 10 10Z"
        fill="currentColor"
      />
    </svg>
  )
}
