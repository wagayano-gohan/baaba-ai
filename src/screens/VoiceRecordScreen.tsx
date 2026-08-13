import { useCallback, useEffect, useRef, useState } from 'react'
import { StopIcon } from '../components/icons'
import { VoiceRecorder, VoiceRecorderError } from '../lib/voice/recorder'
import { extractIntent, mergeTranscript, transcribeAudio } from '../lib/voice/voicePipeline'
import type { VoiceFollowUp, VoiceIntentResult } from '../lib/voice/voicePipeline'
import './VoiceRecordScreen.css'

interface VoiceRecordScreenProps {
  /** 文字起こしと意図抽出まで成功したときに呼ばれる。 */
  onRecognized: (result: VoiceIntentResult, transcript: string) => void
  /** マイク不可・文字起こし失敗などで、録音フローを中断するときに呼ばれる。 */
  onCancel: () => void
  /** 聞き返しに答えてもらう場合、直前までの発話を引き継ぐ。 */
  followUp?: VoiceFollowUp | null
  /** 聞き返しの質問文（画面に出して、何を答えればよいかを分かるようにする）。 */
  question?: string | null
}

type Phase = 'starting' | 'recording' | 'transcribing' | 'extracting' | 'error'

const MIC_ERROR_MESSAGE = 'マイクを使用できませんでした'
const TRANSCRIBE_ERROR_MESSAGE = '音声を認識できませんでした'
const RETURN_DELAY_MS = 2400

// Phase2 ②音声基盤: 録音 → transcribe-audio（文字起こし）→ process-voice-input（意図解析）。
// 実際のDB書き込みは行わず、結果は確認画面(VoiceConfirmScreen)へ渡す。
export function VoiceRecordScreen({
  onRecognized,
  onCancel,
  followUp = null,
  question = null,
}: VoiceRecordScreenProps) {
  const [phase, setPhase] = useState<Phase>('starting')
  const [errorText, setErrorText] = useState('')

  const recorderRef = useRef<VoiceRecorder | null>(null)
  // 停止処理を二重に走らせないためのフラグ。
  const handledRef = useRef(false)
  // 「中止する」または画面離脱でこのフローが終了したことを示すフラグ。
  // 処理中に中断した場合、後から届いたfetchのレスポンスでsetStateやonRecognizedが
  // 呼ばれないようにするために使う。
  const abandonedRef = useRef(false)

  // マウント時に録音を開始する。
  useEffect(() => {
    let cancelled = false
    const recorder = new VoiceRecorder()
    recorderRef.current = recorder

    void (async () => {
      try {
        await recorder.start()
        if (cancelled) {
          recorder.cancel()
          return
        }
        setPhase('recording')
      } catch (error) {
        if (cancelled) return
        console.error('[VoiceRecordScreen] 録音を開始できませんでした:', error)
        setErrorText(
          error instanceof VoiceRecorderError && error.kind === 'unsupported'
            ? 'この端末では音声入力を利用できません'
            : MIC_ERROR_MESSAGE,
        )
        setPhase('error')
      }
    })()

    return () => {
      cancelled = true
      abandonedRef.current = true
      // 画面を離れるときは必ずマイクを解放する。
      recorder.cancel()
    }
  }, [])

  // エラー表示は一定時間見せてから呼び出し元へ戻す。
  useEffect(() => {
    if (phase !== 'error') return
    const timer = window.setTimeout(() => onCancel(), RETURN_DELAY_MS)
    return () => window.clearTimeout(timer)
  }, [phase, onCancel])

  const handleStop = useCallback(() => {
    const recorder = recorderRef.current
    if (!recorder || handledRef.current) return
    handledRef.current = true
    setPhase('transcribing')

    void (async () => {
      try {
        const audio = await recorder.stop()
        if (abandonedRef.current) return

        const transcript = await transcribeAudio(audio.blob, audio.mimeType)
        if (abandonedRef.current) return

        setPhase('extracting')
        // 聞き返しへの答えのときは、前の発話と合わせて解析する。
        const result = await extractIntent(transcript, followUp)
        if (abandonedRef.current) return

        onRecognized(result, mergeTranscript(followUp, transcript))
      } catch (error) {
        // 中断後に届いた失敗はもう画面に出さない。
        if (abandonedRef.current) return
        console.error('[VoiceRecordScreen] 音声処理に失敗しました:', error)
        setErrorText(
          error instanceof VoiceRecorderError && error.kind === 'empty_audio'
            ? '音声が検出されませんでした'
            : TRANSCRIBE_ERROR_MESSAGE,
        )
        setPhase('error')
      }
    })()
  }, [onRecognized, followUp])

  // 録音中・処理中のどちらでも押せる中断導線。
  // 通信が返らないときでもユーザーが自分で画面から抜けられるようにする。
  const handleAbort = useCallback(() => {
    if (abandonedRef.current) return
    abandonedRef.current = true
    handledRef.current = true
    // マイクのトラックを確実に解放してから戻る。
    recorderRef.current?.cancel()
    onCancel()
  }, [onCancel])

  const isBusy = phase === 'transcribing' || phase === 'extracting'

  let title = 'お聞きしています'
  if (phase === 'starting') title = '準備しています'
  if (isBusy) title = '処理しています'

  // 聞き返しに答えてもらう場合は、何を答えればよいかを画面に出し続ける。
  let hint = question ?? 'ご用件をお話しください'
  if (phase === 'starting') hint = '少々お待ちください'
  if (phase === 'transcribing') hint = '音声を文字に変換しています…'
  if (phase === 'extracting') hint = '内容を確認しています…'

  return (
    <div className="voice-record-screen">
      {phase === 'error' ? (
        <div className="voice-record-screen__message">
          <h1 className="voice-record-screen__title">{errorText}</h1>
          <p className="voice-record-screen__caption">もう一度お試しください</p>
        </div>
      ) : (
        <div className="voice-record-screen__message">
          <h1 className="voice-record-screen__title">{title}</h1>
          <div className="voice-record-screen__indicator">
            <span
              className={
                phase === 'recording'
                  ? 'voice-record-dot voice-record-dot--live'
                  : 'voice-record-dot'
              }
              aria-hidden="true"
            />
            <span className="voice-record-screen__hint">{hint}</span>
          </div>
        </div>
      )}

      {phase !== 'error' && (
        <div className="voice-record-screen__action">
          {phase === 'recording' && (
            <>
              <button
                type="button"
                className="voice-stop-button tap-feedback"
                onClick={handleStop}
                aria-label="お話が終わったらボタンを押してください"
              >
                <StopIcon size={44} />
              </button>
              <p className="voice-record-screen__caption">お話が終わったらボタンを押してください</p>
            </>
          )}

          <button type="button" className="voice-abort-button tap-feedback" onClick={handleAbort}>
            中止する
          </button>
        </div>
      )}
    </div>
  )
}
