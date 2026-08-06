// MediaRecorderの薄いラッパー。
// 音声入力の「録音」責務だけを担い、文字起こし・意図解析は voicePipeline.ts が担当する。
//
// iOS Safariはaudio/webmに非対応（audio/mp4のみ対応）のため、MIMEタイプは候補を順に試す。
// MediaRecorder.isTypeSupported が無い環境ではMIME指定なしでMediaRecorderを生成し、
// ブラウザ既定のコンテナに任せる。

/** 録音失敗の種別。画面側はこれを見て文言を出し分ける。 */
export type VoiceRecorderErrorKind =
  /** ブラウザがgetUserMedia/MediaRecorderに未対応 */
  | 'unsupported'
  /** ユーザーがマイクの使用を拒否した、またはマイクが見つからない */
  | 'permission_denied'
  /** 録音は動いたが音声データが空だった */
  | 'empty_audio'
  /** その他（想定外） */
  | 'unknown'

export class VoiceRecorderError extends Error {
  readonly kind: VoiceRecorderErrorKind
  readonly cause?: unknown

  constructor(kind: VoiceRecorderErrorKind, message: string, cause?: unknown) {
    super(message)
    this.name = 'VoiceRecorderError'
    this.kind = kind
    this.cause = cause
  }
}

/** 録音結果。voicePipeline.transcribeAudio() にそのまま渡せる形にする。 */
export interface RecordedAudio {
  blob: Blob
  mimeType: string
  /** multipart送信時のファイル名（拡張子はmimeTypeから推定する） */
  fileName: string
}

// 優先順: Opus指定webm → webm → mp4(iOS Safari) → aac → 指定なし（''）
const MIME_CANDIDATES = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/aac']

/**
 * この端末のMediaRecorderが対応しているMIMEタイプを返す。
 * どれも対応していない／判定APIが無い場合は空文字（＝MIME指定なしで生成する）。
 */
export function pickSupportedMimeType(): string {
  if (typeof MediaRecorder === 'undefined') return ''
  if (typeof MediaRecorder.isTypeSupported !== 'function') return ''
  for (const type of MIME_CANDIDATES) {
    if (MediaRecorder.isTypeSupported(type)) return type
  }
  return ''
}

/** MIMEタイプから送信用ファイルの拡張子を推定する。 */
export function extensionForMimeType(mimeType: string): string {
  if (mimeType.includes('mp4')) return 'mp4'
  if (mimeType.includes('m4a')) return 'm4a'
  if (mimeType.includes('aac')) return 'aac'
  if (mimeType.includes('ogg')) return 'ogg'
  if (mimeType.includes('mpeg')) return 'mp3'
  if (mimeType.includes('wav')) return 'wav'
  return 'webm'
}

/** ブラウザが録音に対応しているか。 */
export function isRecordingSupported(): boolean {
  return (
    typeof navigator !== 'undefined' &&
    typeof navigator.mediaDevices?.getUserMedia === 'function' &&
    typeof MediaRecorder !== 'undefined'
  )
}

/**
 * 1回の録音セッションを扱うクラス。
 * 使い方: `const r = new VoiceRecorder(); await r.start(); ... const audio = await r.stop()`
 * 中断する場合は `r.cancel()` を呼ぶ（マイクのトラックも必ず停止する）。
 */
export class VoiceRecorder {
  private recorder: MediaRecorder | null = null
  private stream: MediaStream | null = null
  private chunks: BlobPart[] = []
  private stopped = false

  /** 録音中かどうか。 */
  get isRecording(): boolean {
    return this.recorder !== null && this.recorder.state === 'recording'
  }

  /**
   * マイク取得（getUserMedia）と録音開始。
   * 失敗時は VoiceRecorderError を投げる。
   */
  async start(): Promise<void> {
    if (!isRecordingSupported()) {
      throw new VoiceRecorderError('unsupported', 'この端末では録音ができません')
    }

    let stream: MediaStream
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    } catch (error) {
      // NotAllowedError（拒否）/ NotFoundError（マイク無し）は同じ文言で扱う。
      throw new VoiceRecorderError('permission_denied', 'マイクを使えませんでした', error)
    }

    this.stream = stream
    this.chunks = []
    this.stopped = false

    try {
      const mimeType = pickSupportedMimeType()
      const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream)
      recorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) this.chunks.push(event.data)
      }
      this.recorder = recorder
      recorder.start()
    } catch (error) {
      this.stopTracks()
      throw new VoiceRecorderError('unknown', '録音を開始できませんでした', error)
    }
  }

  /**
   * 録音を停止し、録音データを返す。マイクのトラックも停止する。
   * 音声が空だった場合は VoiceRecorderError('empty_audio') を投げる。
   */
  stop(): Promise<RecordedAudio> {
    const recorder = this.recorder
    if (!recorder || this.stopped || recorder.state === 'inactive') {
      this.stopTracks()
      return Promise.reject(new VoiceRecorderError('unknown', '録音が開始されていません'))
    }
    this.stopped = true

    return new Promise<RecordedAudio>((resolve, reject) => {
      recorder.onstop = () => {
        this.stopTracks()
        // recorder.mimeType はブラウザが実際に使ったMIMEを返す（未指定生成時も入る）。
        const mimeType = recorder.mimeType || 'audio/webm'
        const blob = new Blob(this.chunks, { type: mimeType })
        this.chunks = []
        if (blob.size === 0) {
          reject(new VoiceRecorderError('empty_audio', '声が録音できませんでした'))
          return
        }
        resolve({ blob, mimeType, fileName: `recording.${extensionForMimeType(mimeType)}` })
      }
      recorder.onerror = (event) => {
        this.stopTracks()
        reject(new VoiceRecorderError('unknown', '録音中にエラーが発生しました', event))
      }
      try {
        recorder.stop()
      } catch (error) {
        this.stopTracks()
        reject(new VoiceRecorderError('unknown', '録音を停止できませんでした', error))
      }
    })
  }

  /** 録音結果を捨てて中断する（画面のアンマウント時などに呼ぶ）。 */
  cancel(): void {
    const recorder = this.recorder
    this.stopped = true
    this.chunks = []
    if (recorder && recorder.state !== 'inactive') {
      recorder.onstop = null
      recorder.onerror = null
      try {
        recorder.stop()
      } catch {
        // 停止できなくてもトラック停止は必ず行うため無視する。
      }
    }
    this.stopTracks()
  }

  /** マイクのトラックを解放する（録音インジケータを消すために必須）。 */
  private stopTracks(): void {
    this.stream?.getTracks().forEach((track) => track.stop())
    this.stream = null
    this.recorder = null
  }
}
