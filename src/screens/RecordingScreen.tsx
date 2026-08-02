import { useCallback, useEffect, useRef, useState } from 'react'
import { StopIcon } from '../components/icons'
import type { VoiceDraftSchedule } from '../data/schedules'
import { buildDateFromExtractedParts, toDateLabel, toTimeLabel } from '../utils/date'
import './RecordingScreen.css'

interface RecordingScreenProps {
  /** 音声から予定登録の意図・日時・タイトルを認識できたときに呼ばれる。 */
  onRecognized: (draft: VoiceDraftSchedule) => void
  /** マイク不可・認識失敗・意図不明のときに一定時間後、または任意のタイミングで呼ばれる。 */
  onCancel: () => void
}

type Phase = 'recording' | 'processing' | 'error'

interface ExtractIntentResponse {
  intent: 'register_appointment' | 'unknown'
  title?: string | null
  date?: string | null
  time?: string | null
}

// iOS Safariはaudio/webmに非対応のためaudio/mp4等へフォールバックする。
const MIME_CANDIDATES = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/aac']

function pickMimeType(): string {
  if (typeof MediaRecorder === 'undefined' || typeof MediaRecorder.isTypeSupported !== 'function') return ''
  for (const type of MIME_CANDIDATES) {
    if (MediaRecorder.isTypeSupported(type)) return type
  }
  return ''
}

function extensionFor(mimeType: string): string {
  if (mimeType.includes('mp4')) return 'mp4'
  if (mimeType.includes('aac')) return 'aac'
  return 'webm'
}

const UNRECOGNIZED_MESSAGE = 'うまく分かりませんでした。もう一度お願いします'
const MIC_ERROR_MESSAGE = 'マイクを使えませんでした。もう一度お願いします'
const RETURN_DELAY_MS = 2200

// 仕様書 8章: ②録音中画面
// MediaRecorderで実際に録音し、停止で /api/transcribe → /api/extract-intent の順に呼び出す。
export function RecordingScreen({ onRecognized, onCancel }: RecordingScreenProps) {
  const [phase, setPhase] = useState<Phase>('recording')
  const [processingLabel, setProcessingLabel] = useState('文字にしています…')
  const [errorText, setErrorText] = useState('')

  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const chunksRef = useRef<BlobPart[]>([])
  const stoppedRef = useRef(false)

  const stopTracks = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop())
    streamRef.current = null
  }, [])

  useEffect(() => {
    let cancelled = false

    async function start() {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop())
          return
        }
        streamRef.current = stream

        const mimeType = pickMimeType()
        const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream)
        mediaRecorderRef.current = recorder
        chunksRef.current = []

        recorder.ondataavailable = (event) => {
          if (event.data && event.data.size > 0) chunksRef.current.push(event.data)
        }

        recorder.start()
      } catch (error) {
        if (cancelled) return
        console.error('[RecordingScreen] getUserMedia failed:', error)
        setErrorText(MIC_ERROR_MESSAGE)
        setPhase('error')
      }
    }

    start()

    return () => {
      cancelled = true
      stopTracks()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (phase !== 'error') return
    const timer = window.setTimeout(() => onCancel(), RETURN_DELAY_MS)
    return () => window.clearTimeout(timer)
  }, [phase, onCancel])

  const handleStop = useCallback(() => {
    const recorder = mediaRecorderRef.current
    if (!recorder || stoppedRef.current || recorder.state === 'inactive') return
    stoppedRef.current = true
    setPhase('processing')
    setProcessingLabel('文字にしています…')

    recorder.onstop = async () => {
      stopTracks()
      try {
        const mimeType = recorder.mimeType || 'audio/webm'
        const blob = new Blob(chunksRef.current, { type: mimeType })
        if (blob.size === 0) throw new Error('録音データが空です')

        const formData = new FormData()
        formData.append('audio', blob, `recording.${extensionFor(mimeType)}`)

        const transcribeRes = await fetch('/api/transcribe', { method: 'POST', body: formData })
        if (!transcribeRes.ok) throw new Error(`transcribe failed: ${transcribeRes.status}`)
        const { text } = (await transcribeRes.json()) as { text: string }
        if (!text || !text.trim()) throw new Error('empty transcript')

        setProcessingLabel('内容を確認しています…')

        const extractRes = await fetch('/api/extract-intent', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text }),
        })
        if (!extractRes.ok) throw new Error(`extract-intent failed: ${extractRes.status}`)
        const result = (await extractRes.json()) as ExtractIntentResponse

        if (result.intent !== 'register_appointment' || !result.title) {
          throw new Error('unknown intent')
        }

        const scheduledAt = buildDateFromExtractedParts(result.date, result.time)
        onRecognized({
          dateLabel: toDateLabel(scheduledAt),
          timeLabel: toTimeLabel(scheduledAt),
          content: result.title,
        })
      } catch (error) {
        console.error('[RecordingScreen] recognition failed:', error)
        setErrorText(UNRECOGNIZED_MESSAGE)
        setPhase('error')
      }
    }

    recorder.stop()
  }, [onRecognized, stopTracks])

  return (
    <div className="recording-screen">
      {phase !== 'error' && (
        <div className="recording-screen__message">
          <h1 className="recording-screen__title">{phase === 'recording' ? '聞いています' : '考えています'}</h1>
          <div className="recording-screen__indicator">
            <span className="recording-dot" aria-hidden="true" />
            <span className="recording-screen__hint">
              {phase === 'recording' ? 'おはなし ください' : processingLabel}
            </span>
          </div>
        </div>
      )}

      {phase === 'error' && (
        <div className="recording-screen__message">
          <h1 className="recording-screen__title">{errorText}</h1>
        </div>
      )}

      {phase === 'recording' && (
        <div className="recording-screen__action">
          <button
            type="button"
            className="stop-button tap-feedback"
            onClick={handleStop}
            aria-label="おわったら ボタンを おしてください"
          >
            <StopIcon size={44} />
          </button>
          <p className="recording-screen__caption">おわったら ボタンを おしてください</p>
        </div>
      )}
    </div>
  )
}
