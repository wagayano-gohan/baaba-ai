import { useState } from 'react'
import type { ReactNode } from 'react'
import { MenuIcon } from './icons'
import './TopBar.css'

interface TopBarProps {
  title?: string
  right?: ReactNode
}

// 参考画像の共通ヘッダー（左：メニュー／中央：タイトル／右：アイコン）
// メニューは未実装のため、タップしたら準備中であることを明示するパネルを出す（無反応にはしない）。
export function TopBar({ title, right }: TopBarProps) {
  const [menuOpen, setMenuOpen] = useState(false)

  return (
    <header className="top-bar">
      <button
        type="button"
        className="top-bar__icon-button tap-feedback"
        aria-label="メニュー"
        onClick={() => setMenuOpen(true)}
      >
        <MenuIcon size={24} />
      </button>
      {title && <h1 className="top-bar__title">{title}</h1>}
      <div className="top-bar__right">{right}</div>

      {menuOpen && (
        <div className="top-bar__menu-overlay" onClick={() => setMenuOpen(false)}>
          <div className="top-bar__menu-panel" role="dialog" aria-label="メニュー" onClick={(e) => e.stopPropagation()}>
            <p className="top-bar__menu-text">メニューは準備中です</p>
            <button type="button" className="top-bar__menu-close tap-feedback" onClick={() => setMenuOpen(false)}>
              閉じる
            </button>
          </div>
        </div>
      )}
    </header>
  )
}
