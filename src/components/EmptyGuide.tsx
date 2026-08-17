// データがまだ無いときの案内。
//
// 「登録されていません → ご家族に登録してもらう」ではなく、
// 「まだ覚えていません → ばーばAIに話しかける → AIが覚える」を標準の流れにする。
// そのため、状況・話しかけ方の例・その場で始められるボタンの3つをそろえて表示する。
//
// ご本人向け画面の空状態はすべてこの部品に統一し、
// 画面ごとに文言や見た目がばらつかないようにする。

import { MicIcon } from './icons'
import './EmptyGuide.css'

interface EmptyGuideProps {
  /** いまの状況（例：「ゴミの日はまだ覚えていません」）。 */
  title: string
  /** 話しかけ方・書き方の例。かぎかっこは内側で付けるため、中身だけを渡す。 */
  examples: string[]
  /** ボタンの文言。省略時は音声入力の「話しかける」。 */
  actionLabel?: string
  /**
   * ボタンを押したとき。
   * 渡されない場合はボタンを出さず、例文だけを示す
   * （その画面の中に入力欄がある場合など、移動の必要が無いとき）。
   */
  onAction?: () => void
}

export function EmptyGuide({ title, examples, actionLabel, onAction }: EmptyGuideProps) {
  // 音声入力へ誘導するとき（既定）だけマイクの絵を添える。
  // 「AIに相談する」など行き先が違う場合に、マイクの絵があると誤解を招くため。
  const isVoice = actionLabel === undefined

  return (
    <div className="empty-guide">
      <p className="empty-guide__title">{title}</p>
      <p className="empty-guide__lead">
        {!onAction
          ? 'こう書いてください'
          : isVoice
            ? '下のボタンを押して、こう話しかけてください'
            : '下のボタンを押して、こう聞いてください'}
      </p>
      <ul className="empty-guide__examples">
        {examples.map((example) => (
          <li key={example} className="empty-guide__example">
            「{example}」
          </li>
        ))}
      </ul>
      {onAction && (
        <button type="button" className="empty-guide__button tap-feedback" onClick={onAction}>
          {isVoice && (
            <span className="empty-guide__button-icon" aria-hidden="true">
              <MicIcon size={26} />
            </span>
          )}
          {actionLabel ?? '話しかける'}
        </button>
      )}
    </div>
  )
}
