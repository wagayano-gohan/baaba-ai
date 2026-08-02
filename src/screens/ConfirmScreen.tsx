import { useEffect, useState } from 'react'
import type { VoiceDraftSchedule } from '../data/schedules'
import './ConfirmScreen.css'

export type ConfirmMode = 'register' | 'edit'

interface ConfirmScreenProps {
  mode: ConfirmMode
  item: VoiceDraftSchedule
  /** 「はい」/「へんこうする」タップ→完了表示(1.5秒)後に呼ばれる */
  onComplete: () => void
  /** 「ちがう」/「やめる」タップで即座に呼ばれる */
  onCancel: () => void
}

const COMPLETE_DISPLAY_MS = 1500

// 仕様書 9章: ③AI確認画面
// 仕様書 10.4: ④予定一覧の「へんこう」からもこのレイアウトを再利用する（文言のみ差し替え）
export function ConfirmScreen({ mode, item, onComplete, onCancel }: ConfirmScreenProps) {
  const [showComplete, setShowComplete] = useState(false)

  useEffect(() => {
    if (!showComplete) return
    const timer = window.setTimeout(() => {
      onComplete()
    }, COMPLETE_DISPLAY_MS)
    return () => window.clearTimeout(timer)
  }, [showComplete, onComplete])

  const heading =
    mode === 'register' ? 'この よていを 登録しますか？' : 'よていを 変更しますか？'
  const primaryLabel = mode === 'register' ? 'はい' : 'へんこうする'
  const secondaryLabel = mode === 'register' ? 'ちがう' : 'やめる'
  const completeMessage = mode === 'register' ? 'とうろくしました' : 'へんこうしました'

  return (
    <div className="confirm-screen">
      <h1 className="confirm-screen__heading">{heading}</h1>

      <section className="confirm-card" aria-label="よていの内容">
        <p className="confirm-card__date">{item.dateLabel}</p>
        <p className="confirm-card__time">{item.timeLabel}</p>
        <p className="confirm-card__content">{item.content}</p>
      </section>

      <div className="confirm-screen__actions">
        <button
          type="button"
          className="confirm-button confirm-button--primary tap-feedback"
          onClick={() => setShowComplete(true)}
        >
          {primaryLabel}
        </button>
        <button
          type="button"
          className="confirm-button confirm-button--secondary tap-feedback"
          onClick={onCancel}
        >
          {secondaryLabel}
        </button>
      </div>

      {showComplete && (
        <div className="confirm-overlay" role="status">
          <p className="confirm-overlay__text">{completeMessage}</p>
        </div>
      )}
    </div>
  )
}
