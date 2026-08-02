import { HomeIcon, CalendarIcon, BagIcon } from './icons'
import './BottomNav.css'

type Tab = 'home' | 'schedule' | 'reservation'

interface BottomNavProps {
  active: Tab
  onNavigateTab: (tab: Tab) => void
}

// 参考画像の下部ナビゲーション（ホーム／予定／予約）。全メイン画面で固定表示する。
export function BottomNav({ active, onNavigateTab }: BottomNavProps) {
  return (
    <nav className="bottom-nav" aria-label="画面メニュー">
      <button
        type="button"
        className={`bottom-nav__tab tap-feedback ${active === 'home' ? 'is-active' : ''}`}
        onClick={() => onNavigateTab('home')}
      >
        <HomeIcon size={24} />
        <span>ホーム</span>
      </button>
      <button
        type="button"
        className={`bottom-nav__tab tap-feedback ${active === 'schedule' ? 'is-active' : ''}`}
        onClick={() => onNavigateTab('schedule')}
      >
        <CalendarIcon size={24} />
        <span>予定</span>
      </button>
      <button
        type="button"
        className={`bottom-nav__tab tap-feedback ${active === 'reservation' ? 'is-active' : ''}`}
        onClick={() => onNavigateTab('reservation')}
      >
        <BagIcon size={24} />
        <span>予約</span>
      </button>
    </nav>
  )
}
