import type { ReactNode } from 'react'
import { MenuIcon } from './icons'
import './TopBar.css'

interface TopBarProps {
  title?: string
  right?: ReactNode
}

// 参考画像の共通ヘッダー（左：メニュー／中央：タイトル／右：アイコン）
export function TopBar({ title, right }: TopBarProps) {
  return (
    <header className="top-bar">
      <button type="button" className="top-bar__icon-button" aria-label="メニュー">
        <MenuIcon size={24} />
      </button>
      {title && <h1 className="top-bar__title">{title}</h1>}
      <div className="top-bar__right">{right}</div>
    </header>
  )
}
