import { HomeIcon, CalendarIcon } from './icons'
import './BottomNav.css'

interface BottomNavProps {
  active: 'home' | 'list'
  onNavigateHome: () => void
  onNavigateList: () => void
}

// 仕様書 6章: 下部メニューの仕様（①ホーム・④予定一覧のみで使用）
export function BottomNav({ active, onNavigateHome, onNavigateList }: BottomNavProps) {
  return (
    <nav className="bottom-nav" aria-label="画面メニュー">
      <button
        type="button"
        className={`bottom-nav__tab tap-feedback ${active === 'home' ? 'is-active' : ''}`}
        onClick={onNavigateHome}
      >
        <HomeIcon size={30} />
        <span>ホーム</span>
      </button>
      <button
        type="button"
        className={`bottom-nav__tab tap-feedback ${active === 'list' ? 'is-active' : ''}`}
        onClick={onNavigateList}
      >
        <CalendarIcon size={30} />
        <span>よてい</span>
      </button>
    </nav>
  )
}
