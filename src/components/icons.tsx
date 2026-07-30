// シンプルな線画アイコン群。すべて currentColor で色を継承する。
// 「介護」「監視」「見守り」を想起させる意匠（カメラ、GPS、通知バッジ等）は使用しない。

export function HomeIcon({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M3.5 11L12 4l8.5 7"
        stroke="currentColor"
        strokeWidth={2.2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M5.5 9.5V19a1 1 0 0 0 1 1H9a1 1 0 0 0 1-1v-4a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v4a1 1 0 0 0 1 1h2.5a1 1 0 0 0 1-1V9.5"
        stroke="currentColor"
        strokeWidth={2.2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

export function CalendarIcon({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect
        x="3.5"
        y="5"
        width="17"
        height="15.5"
        rx="2.5"
        stroke="currentColor"
        strokeWidth={2.2}
      />
      <path d="M7.5 3v4M16.5 3v4" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" />
      <path d="M3.5 10h17" stroke="currentColor" strokeWidth={2.2} />
    </svg>
  )
}

export function MicIcon({ size = 56 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="9" y="2.5" width="6" height="12" rx="3" fill="white" />
      <path
        d="M6 11v1.5a6 6 0 0 0 12 0V11"
        stroke="white"
        strokeWidth={2.2}
        strokeLinecap="round"
      />
      <path d="M12 18.5v3" stroke="white" strokeWidth={2.2} strokeLinecap="round" />
      <path d="M8.5 21.5h7" stroke="white" strokeWidth={2.2} strokeLinecap="round" />
    </svg>
  )
}

export function StopIcon({ size = 44 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="5" y="5" width="14" height="14" rx="3" fill="white" />
    </svg>
  )
}
