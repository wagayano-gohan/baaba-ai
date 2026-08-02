import { useEffect, useState } from 'react'
import type { VoiceDraftSchedule } from '../data/schedules'
import './ConfirmScreen.css'

export type ConfirmMode = 'register' | 'edit'

interface ConfirmScreenProps {
  mode: ConfirmMode
  item: VoiceDraftSchedule
  /** 「はい」/「へんこうする」タップで呼ばれる。Supabaseへの保存処理を行う。 */
  onSubmit: () => Promise<void>
  /** 保存成功→完了表示(1.5秒)後に呼ばれる */
  onComplete: () => void
  /** 「ちがう」/「やめる」タップで即座に呼ばれる */
  onCancel: () => void
}

const COMPLETE_DISPLAY_MS = 1500

// 仕様書 9章: ③AI確認画面
// 仕様書 10.4: ④予定一覧の「へんこう」からもこのレイアウトを再利用する（文言のみ差し替え）
export function ConfirmScreen({ mode, item, onSubmit, onComplete, onCancel }: ConfirmScreenProps) {
  const [phase, setPhase] = useState<'idle' | 'submitting' | 'success' | 'error'>('idle')
  const [errorMessage, setErrorMessage] = useState('')

  useEffect(() => {
    if (phase !== 'success') return
    const timer = window.setTimeout(() => {
      onComplete()
    }, COMPLETE_DISPLAY_MS)
    return () => window.clearTimeout(timer)
  }, [phase, onComplete])

  const handlePrimaryTap = async () => {
    setPhase('submitting')
    try {
      await onSubmit()
      setPhase('success')
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : String(error))
      setPhase('error')
    }
  }

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

      {phase === 'error' && <p className="confirm-screen__error">エラー: {errorMessage}</p>}

      <div className="confirm-screen__actions">
        <button
          type="button"
          className="confirm-button confirm-button--primary tap-feedback"
          onClick={handlePrimaryTap}
          disabled={phase === 'submitting'}
        >
          {phase === 'submitting' ? '保存しています…' : primaryLabel}
        </button>
        <button
          type="button"
          className="confirm-button confirm-button--secondary tap-feedback"
          onClick={onCancel}
          disabled={phase === 'submitting'}
        >
          {secondaryLabel}
        </button>
      </div>

      {phase === 'success' && (
        <div className="confirm-overlay" role="status">
          <p className="confirm-overlay__text">{completeMessage}</p>
        </div>
      )}
    </div>
  )
}
