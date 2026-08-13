// 音声の応答画面。ご本人の発話に対する
//   - confirm  … 「はい」で登録・記録する確認
//   - question … 足りない情報を1つだけ聞き返す
//   - answer   … その場でお答えするだけ（ゴミの日・予定・買うものなど）
// の3つを扱う。いずれも結果は必ず文章で大きく表示する。

import { useCallback, useRef, useState } from 'react'
import { ApiCallError, callDeviceAuthedFunction } from '../lib/apiClient'
import { confirmAction } from '../lib/voice/voicePipeline'
import type { VoiceFollowUp, VoiceIntent, VoiceIntentResult } from '../lib/voice/voicePipeline'
import './VoiceConfirmScreen.css'

interface VoiceConfirmScreenProps {
  result: VoiceIntentResult
  /** 文字起こしの原文。聞き間違いをユーザー自身が確認できるよう必ず表示する。 */
  transcript: string
  /** 「はい」で確認を送り終えたときに呼ばれる。 */
  onDone: () => void
  /** 「いいえ、修正する」「もう一度やり直す」で録音をやり直すときに呼ばれる。 */
  onRetry: () => void
  /** 聞き返しに答えてもらうため、前の発話を引き継いで録音へ戻るときに呼ばれる。 */
  onAnswerQuestion: (followUp: VoiceFollowUp) => void
}

type Phase = 'idle' | 'sending' | 'accepted' | 'failed'

/** 「予定」「やること」のどちらか、利用者が選んだ種別。未選択はnull。 */
type ChosenIntent = 'create_event' | 'create_task'

// 予定なのかやることなのか判別できなかったとき、サーバーは intent='ambiguous' を返す。
// この場合は勝手に決めつけず、利用者に「予定」「やること」を選んでもらう。
const AMBIGUOUS_INTENT: VoiceIntent = 'ambiguous'

const WEEKDAY_LABELS = ['日', '月', '火', '水', '木', '金', '土']

/** 日付・時刻を欄に分けて見せる意図（それ以外は確認文だけを大きく見せる）。 */
const DATED_INTENTS: VoiceIntent[] = ['create_event', 'create_task', 'add_delivery', 'ambiguous']

/** 'YYYY-MM-DD' を「8月5日（水）」形式にする。解釈できない場合はそのまま返す。 */
function formatDateLabel(date: string | null): string {
  if (!date) return '日付の指定はありません'
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
  if (!time) return '時刻の指定はありません'
  const matched = /^(\d{1,2}):(\d{2})$/.exec(time)
  if (!matched) return time
  return `${Number(matched[1])}時${matched[2]}分`
}

function intentLabel(intent: VoiceIntent | ChosenIntent): string {
  if (intent === 'create_event') return '予定'
  if (intent === 'create_task') return 'やること'
  if (intent === 'add_shopping') return '買い物メモ'
  if (intent === 'complete_task') return '完了の記録'
  if (intent === 'take_medication') return 'お薬を飲んだ記録'
  if (intent === 'add_medication') return 'お薬の登録'
  if (intent === 'add_delivery') return '荷物'
  if (intent === 'set_garbage') return 'ゴミの日'
  if (intent === 'add_contact') return '電話番号'
  if (intent === 'add_location') return 'よく行く場所'
  return '確認'
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

/**
 * 「はい」の送信先。execute-confirmed-action は各テーブルへの書き込みまで行い、
 * その成否を status（executed / failed）で返す。
 * confirmAction（voicePipeline）は戻り値を返さないため、結果の出し分けが必要なここでは
 * Edge Functionを直接呼ぶ。
 */
async function sendConfirmation(voiceRequestId: string, intent?: string): Promise<{ status?: string }> {
  return callDeviceAuthedFunction<{ status?: string }>('execute-confirmed-action', {
    voiceRequestId,
    confirmed: true,
    intent,
  })
}

export function VoiceConfirmScreen({
  result,
  transcript,
  onDone,
  onRetry,
  onAnswerQuestion,
}: VoiceConfirmScreenProps) {
  const [phase, setPhase] = useState<Phase>('idle')
  const [errorText, setErrorText] = useState('')
  // 実際にDBへ登録できたかどうか（execute-confirmed-action の status が 'executed'）。
  const [saved, setSaved] = useState(false)
  // 同じvoiceRequestIdへ確認結果を二重送信しないためのガード。
  const sentRef = useRef(false)
  // intent='ambiguous' のときに利用者が選んだ種別。
  const [chosenIntent, setChosenIntent] = useState<ChosenIntent | null>(null)

  const effectiveIntent: VoiceIntent | ChosenIntent = chosenIntent ?? result.intent
  const isAnswer = result.mode === 'answer'
  const isQuestion = result.mode === 'question'
  // 種別が決まっていないため、まず「予定」「やること」を選んでもらう段階。
  const needsIntentChoice = !isAnswer && !isQuestion && effectiveIntent === AMBIGUOUS_INTENT
  const showDetail = DATED_INTENTS.includes(effectiveIntent as VoiceIntent)

  const handleYes = useCallback(() => {
    if (phase !== 'idle' || sentRef.current) return
    sentRef.current = true
    setPhase('sending')
    setErrorText('')

    void (async () => {
      try {
        if (!result.voiceRequestId) {
          // 送信先が無い＝登録先のリクエストが作られていない。登録できなかったこととして扱う。
          setSaved(false)
          setPhase('accepted')
          window.setTimeout(() => onDone(), 1600)
          return
        }
        // status: 'executed' なら各テーブルへの登録まで完了している。
        const data = await sendConfirmation(result.voiceRequestId, chosenIntent ?? undefined)
        setSaved(data?.status === 'executed')
        setPhase('accepted')
        window.setTimeout(() => onDone(), 1600)
      } catch (error) {
        // サーバー側で既に処理済みだった場合は、先の送信で処理が終わっているため正常扱いにする。
        if (isAlreadyHandled(error)) {
          setSaved(true)
          setPhase('accepted')
          window.setTimeout(() => onDone(), 1600)
          return
        }
        console.error('[VoiceConfirmScreen] 確認の送信に失敗しました:', error)
        setErrorText('確認内容を送信できませんでした')
        setPhase('failed')
      }
    })()
  }, [phase, result.voiceRequestId, chosenIntent, onDone])

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

  const handleAnswer = useCallback(() => {
    onAnswerQuestion({ transcript, asked: result.asked })
  }, [onAnswerQuestion, transcript, result.asked])

  const heading = isAnswer
    ? 'お答えします'
    : isQuestion
      ? 'もう少し教えてください'
      : needsIntentChoice
        ? 'どちらに登録しますか？'
        : 'この内容でよろしいですか？'

  return (
    <div className="voice-confirm-screen">
      <h1 className="voice-confirm-screen__heading">{heading}</h1>

      <section className="voice-confirm-transcript" aria-label="認識した内容">
        <p className="voice-confirm-transcript__label">認識した内容</p>
        <p className="voice-confirm-transcript__text">{transcript}</p>
      </section>

      {isAnswer || isQuestion || needsIntentChoice || !showDetail ? (
        <div
          className={
            'voice-confirm-card' + (isAnswer || isQuestion ? ' voice-confirm-card--unknown' : '')
          }
        >
          {!isAnswer && !isQuestion && (
            <p className="voice-confirm-card__kind">{intentLabel(effectiveIntent)}</p>
          )}
          <p className="voice-confirm-card__prompt" style={{ whiteSpace: 'pre-line' }}>
            {result.confirmationPrompt}
          </p>
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
          // 送信は1回きりのため「はい、登録する」を押し直させない。やり直すか、終了するかを選ばせる。
          <>
            <button
              type="button"
              className="voice-confirm-button voice-confirm-button--primary tap-feedback"
              onClick={onRetry}
            >
              もう一度やり直す
            </button>
            <button
              type="button"
              className="voice-confirm-button voice-confirm-button--secondary tap-feedback"
              onClick={onDone}
            >
              終了する
            </button>
          </>
        ) : isQuestion ? (
          <>
            <button
              type="button"
              className="voice-confirm-button voice-confirm-button--primary tap-feedback"
              onClick={handleAnswer}
            >
              答える（話す）
            </button>
            <button
              type="button"
              className="voice-confirm-button voice-confirm-button--secondary tap-feedback"
              onClick={onDone}
            >
              やめる
            </button>
          </>
        ) : isAnswer ? (
          <>
            {result.phoneNumber && (
              <a
                className="voice-confirm-button voice-confirm-button--primary tap-feedback"
                href={`tel:${result.phoneNumber}`}
                style={{ textAlign: 'center', textDecoration: 'none' }}
              >
                電話をかける
              </a>
            )}
            <button
              type="button"
              className="voice-confirm-button voice-confirm-button--secondary tap-feedback"
              onClick={onRetry}
            >
              もう一度話す
            </button>
            <button
              type="button"
              className="voice-confirm-button voice-confirm-button--secondary tap-feedback"
              onClick={onDone}
            >
              終わる
            </button>
          </>
        ) : needsIntentChoice ? (
          // 種別を選ぶだけの段階。ここではサーバーへ何も送らず、選択後に通常の確認カードへ移る。
          <>
            <button
              type="button"
              className="voice-confirm-button voice-confirm-button--primary tap-feedback"
              onClick={() => setChosenIntent('create_event')}
            >
              予定として登録
            </button>
            <button
              type="button"
              className="voice-confirm-button voice-confirm-button--secondary tap-feedback"
              onClick={() => setChosenIntent('create_task')}
            >
              やることとして登録
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
              はい、お願いします
            </button>
            <button
              type="button"
              className="voice-confirm-button voice-confirm-button--secondary tap-feedback"
              onClick={handleNo}
              disabled={phase !== 'idle'}
            >
              いいえ、修正する
            </button>
          </>
        )}
      </div>

      {phase === 'accepted' && (
        <div className="voice-confirm-overlay">
          <p className="voice-confirm-overlay__text">{saved ? '登録しました' : '登録できませんでした'}</p>
        </div>
      )}
    </div>
  )
}
