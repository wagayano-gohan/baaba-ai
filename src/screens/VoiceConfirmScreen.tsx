import { useCallback, useRef, useState } from 'react'
import { ApiCallError } from '../lib/apiClient'
import { confirmAction } from '../lib/voice/voicePipeline'
import type { VoiceIntent, VoiceIntentResult } from '../lib/voice/voicePipeline'
import './VoiceConfirmScreen.css'

interface VoiceConfirmScreenProps {
  result: VoiceIntentResult
  /** 文字起こしの原文。聞き間違いをユーザー自身が確認できるよう必ず表示する。 */
  transcript: string
  /** 「はい」で確認を送り終えたときに呼ばれる。 */
  onDone: () => void
  /** 「ちがう」「もう一度」で録音をやり直すときに呼ばれる。 */
  onRetry: () => void
}

type Phase = 'idle' | 'sending' | 'accepted' | 'failed'

/** 「よてい」「やること」のどちらか、利用者が選んだ種別。未選択はnull。 */
type ChosenIntent = 'create_event' | 'create_task'

// 予定なのかやることなのか判別できなかったとき、サーバーは intent='ambiguous' を返す。
// この場合は勝手に決めつけず、利用者に「よてい」「やること」を選んでもらう。
const AMBIGUOUS_INTENT: VoiceIntent = 'ambiguous'

const WEEKDAY_LABELS = ['にち', 'げつ', 'か', 'すい', 'もく', 'きん', 'ど']

/** 'YYYY-MM-DD' を「8月5日（すい）」形式にする。解釈できない場合はそのまま返す。 */
function formatDateLabel(date: string | null): string {
  if (!date) return 'ひづけは きいていません'
  const matched = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date)
  if (!matched) return date
  const year = Number(matched[1])
  const month = Number(matched[2])
  const day = Number(matched[3])
  const parsed = new Date(year, month - 1, day)
  if (Number.isNaN(parsed.getTime())) return date
  return `${month}月${day}日（${WEEKDAY_LABELS[parsed.getDay()]}）`
}

function formatTimeLabel(time: string | null): string {
  if (!time) return 'じかんは きいていません'
  const matched = /^(\d{1,2}):(\d{2})$/.exec(time)
  if (!matched) return time
  return `${Number(matched[1])}時${matched[2]}分`
}

function intentLabel(intent: VoiceIntentResult['intent'] | ChosenIntent): string {
  if (intent === 'create_event') return 'よてい'
  if (intent === 'create_task') return 'やること'
  return 'ふめい'
}

/**
 * サーバー側で既に処理済み（VOICE_REQUEST_ALREADY_HANDLED）だったかどうか。
 * confirmActionはApiCallErrorをVoicePipelineErrorのcauseに包んで投げ直すため、
 * エラー自身とcauseの両方を確認する。
 */
function isAlreadyHandled(error: unknown): boolean {
  const codeOf = (value: unknown) => (value instanceof ApiCallError ? value.code : null)
  const cause = (error as { cause?: unknown } | null)?.cause
  return (
    codeOf(error) === 'VOICE_REQUEST_ALREADY_HANDLED' || codeOf(cause) === 'VOICE_REQUEST_ALREADY_HANDLED'
  )
}

// Phase2 ②音声基盤の完了ライン。
// ここでは voice_requests の確認結果（execute-confirmed-action）を送るのみで、
// events/tasks等への実DB書き込みは行わない（Phase3スコープ）。
export function VoiceConfirmScreen({ result, transcript, onDone, onRetry }: VoiceConfirmScreenProps) {
  const [phase, setPhase] = useState<Phase>('idle')
  const [errorText, setErrorText] = useState('')
  // 同じvoiceRequestIdへ確認結果を二重送信しないためのガード。
  // execute-confirmed-action は 'received' 以外のステータスに対して 409
  // (VOICE_REQUEST_ALREADY_HANDLED) を返すため、送信失敗時に同じボタンを押し直させると
  // 必ず再失敗する。そのため「送信は1回だけ」とし、失敗時は先へ進む導線を出す。
  const sentRef = useRef(false)
  // intent='ambiguous' のときに利用者が選んだ種別。
  // Phase2ではDB保存を行わないため、この選択は画面表示の切り替えにのみ使う
  // （サーバーへは既存どおり confirmAction の true/false のみを送る）。
  const [chosenIntent, setChosenIntent] = useState<ChosenIntent | null>(null)

  const effectiveIntent: VoiceIntentResult['intent'] | ChosenIntent = chosenIntent ?? result.intent
  const isUnknown = effectiveIntent === 'unknown' || !result.title
  // 種別が決まっていないため、まず「よてい」「やること」を選んでもらう段階。
  const needsIntentChoice = !isUnknown && effectiveIntent === AMBIGUOUS_INTENT

  const handleYes = useCallback(() => {
    if (phase !== 'idle' || sentRef.current) return
    sentRef.current = true
    setPhase('sending')
    setErrorText('')

    void (async () => {
      try {
        // execute-confirmed-action は現状 status:'failed'(reason:'not_implemented') を返すが、
        // 実書き込みがPhase3スコープであることによる想定内の結果のため、エラー扱いしない。
        await confirmAction(result.voiceRequestId, true)
        setPhase('accepted')
        window.setTimeout(() => onDone(), 1600)
      } catch (error) {
        // サーバー側で既に処理済みだった場合は、こちらの意図どおりに完了しているため正常扱いにする。
        if (isAlreadyHandled(error)) {
          setPhase('accepted')
          window.setTimeout(() => onDone(), 1600)
          return
        }
        console.error('[VoiceConfirmScreen] 確認の送信に失敗しました:', error)
        setErrorText('うまく つたえられませんでした')
        setPhase('failed')
      }
    })()
  }, [phase, result.voiceRequestId, onDone])

  const handleNo = useCallback(() => {
    if (phase !== 'idle' || sentRef.current) return
    sentRef.current = true
    setPhase('sending')
    setErrorText('')

    void (async () => {
      try {
        await confirmAction(result.voiceRequestId, false)
      } catch (error) {
        // 却下の送信に失敗しても、やり直しの導線は止めない。
        console.error('[VoiceConfirmScreen] 却下の送信に失敗しました:', error)
      }
      onRetry()
    })()
  }, [phase, result.voiceRequestId, onRetry])

  return (
    <div className="voice-confirm-screen">
      <h1 className="voice-confirm-screen__heading">
        {isUnknown
          ? 'かくにん できませんでした'
          : needsIntentChoice
            ? 'どちらに しますか？'
            : 'これで よろしいですか？'}
      </h1>

      <section className="voice-confirm-transcript" aria-label="ききとった ことば">
        <p className="voice-confirm-transcript__label">ききとった ことば</p>
        <p className="voice-confirm-transcript__text">{transcript}</p>
      </section>

      {isUnknown ? (
        <div className="voice-confirm-card voice-confirm-card--unknown">
          <p className="voice-confirm-card__prompt">{result.confirmationPrompt}</p>
        </div>
      ) : needsIntentChoice ? (
        <div className="voice-confirm-card voice-confirm-card--choice">
          <p className="voice-confirm-card__prompt">{result.confirmationPrompt}</p>
          <p className="voice-confirm-card__content">{result.title}</p>
        </div>
      ) : (
        <div className="voice-confirm-card">
          <p className="voice-confirm-card__kind">{intentLabel(effectiveIntent)}</p>
          <p className="voice-confirm-card__date">{formatDateLabel(result.date)}</p>
          <p className="voice-confirm-card__time">{formatTimeLabel(result.time)}</p>
          <p className="voice-confirm-card__content">{result.title}</p>
        </div>
      )}

      {errorText !== '' && <p className="voice-confirm-screen__error">{errorText}</p>}

      <div className="voice-confirm-screen__actions">
        {phase === 'failed' ? (
          // 送信は1回きりのため「はい」を押し直させない。やり直すか、いったん終わるかを選ばせる。
          <>
            <button
              type="button"
              className="voice-confirm-button voice-confirm-button--primary tap-feedback"
              onClick={onRetry}
            >
              もう いちど
            </button>
            <button
              type="button"
              className="voice-confirm-button voice-confirm-button--secondary tap-feedback"
              onClick={onDone}
            >
              おわる
            </button>
          </>
        ) : isUnknown ? (
          <button
            type="button"
            className="voice-confirm-button voice-confirm-button--primary tap-feedback"
            onClick={onRetry}
          >
            もう いちど
          </button>
        ) : needsIntentChoice ? (
          // 種別を選ぶだけの段階。ここではサーバーへ何も送らず、選択後に通常の確認カードへ移る。
          <>
            <button
              type="button"
              className="voice-confirm-button voice-confirm-button--primary tap-feedback"
              onClick={() => setChosenIntent('create_event')}
            >
              よてい
            </button>
            <button
              type="button"
              className="voice-confirm-button voice-confirm-button--secondary tap-feedback"
              onClick={() => setChosenIntent('create_task')}
            >
              やること
            </button>
          </>
        ) : (
          <>
            <button
              type="button"
              className="voice-confirm-button voice-confirm-button--primary tap-feedback"
              onClick={handleYes}
              disabled={phase !== 'idle'}
            >
              はい
            </button>
            <button
              type="button"
              className="voice-confirm-button voice-confirm-button--secondary tap-feedback"
              onClick={handleNo}
              disabled={phase !== 'idle'}
            >
              ちがう
            </button>
          </>
        )}
      </div>

      {phase === 'accepted' && (
        <div className="voice-confirm-overlay">
          <p className="voice-confirm-overlay__text">わかりました</p>
        </div>
      )}
    </div>
  )
}
