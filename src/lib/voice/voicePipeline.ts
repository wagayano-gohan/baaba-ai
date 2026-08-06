// 音声入力パイプライン（録音Blob → 文字起こし → 意図解析 → 確認結果の送信）。
//
// すべてクラウド（Supabase Edge Functions）で完結する。PCのローカルサーバーには依存しない。
//   - 文字起こし … transcribe-audio。本人端末（デバイストークン）でも家族端末（JWT）でも呼べる。
//   - 意図解析 … process-voice-input。voice_requests への記録を伴うためデバイス認証必須。
//     デバイス未登録の端末では利用できず、DEVICE_NOT_REGISTERED として明示的に失敗させる。
//   - 確認結果の送信 … execute-confirmed-action（デバイス認証）。

import { ApiCallError, callDeviceAuthedFunction, callFlexibleAuthedFunctionWithFormData } from '../apiClient'
import { hasRegisteredDevice } from '../deviceToken'
import { extensionForMimeType } from './recorder'

/**
 * Phase2で扱う意図の種別。これ以外の意図は追加しない。
 *   - ambiguous … 予定（create_event）かやること（create_task）か判別できない場合。
 *                 勝手に保存せず、confirmationPrompt でユーザーに聞き返す。
 *   - unknown   … そもそも意図が読み取れない場合。
 */
export type VoiceIntent = 'create_event' | 'create_task' | 'ambiguous' | 'unknown'

export interface VoiceIntentResult {
  /** process-voice-input で採番される voice_requests のID。 */
  voiceRequestId: string | null
  intent: VoiceIntent
  title: string | null
  /** YYYY-MM-DD */
  date: string | null
  /** HH:MM（24時間表記） */
  time: string | null
  /** 画面と読み上げで使う確認文言。 */
  confirmationPrompt: string
}

/** 文字起こし・意図解析の失敗を表すエラー。 */
export class VoicePipelineError extends Error {
  readonly step: 'transcribe' | 'extract' | 'confirm'
  readonly cause?: unknown

  constructor(step: 'transcribe' | 'extract' | 'confirm', message: string, cause?: unknown) {
    super(message)
    this.name = 'VoicePipelineError'
    this.step = step
    this.cause = cause
  }
}

// --- 内部ユーティリティ -------------------------------------------------

function asIntent(value: unknown): VoiceIntent {
  return value === 'create_event' || value === 'create_task' || value === 'ambiguous' ? value : 'unknown'
}

function asNullableString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value : null
}

const UNKNOWN_PROMPT = '内容を確認できませんでした。もう一度お話しください。'
const AMBIGUOUS_PROMPT = '予定として登録しますか？ やることとして登録しますか？'

/** 確認文言が返らなかった場合に、抽出結果から組み立てる。 */
function buildConfirmationPrompt(
  intent: VoiceIntent,
  title: string | null,
  date: string | null,
  time: string | null,
): string {
  if (intent === 'unknown' || !title) return UNKNOWN_PROMPT
  // 予定かやることか判別できない場合は、勝手に保存せずユーザーへ聞き返す。
  if (intent === 'ambiguous') return AMBIGUOUS_PROMPT
  const kind = intent === 'create_event' ? '予定' : 'やること'
  const when = [date ?? '', time ?? ''].filter((part) => part !== '').join(' ')
  return when ? `${when} の ${title} を ${kind} に登録します。よろしいですか？` : `${title} を ${kind} に登録します。よろしいですか？`
}

// 応答が返らないまま画面が固まるのを防ぐためのタイムアウト（ミリ秒）。
// 文字起こしは音声アップロードを伴うため長めに取る。
const TRANSCRIBE_TIMEOUT_MS = 60_000
const EXTRACT_TIMEOUT_MS = 30_000

/**
 * AbortSignal.timeout() を使う。未対応環境ではundefinedを返し、タイムアウト無しで動作させる
 * （fetchのsignalにundefinedを渡すのは合法）。
 */
function timeoutSignal(ms: number): AbortSignal | undefined {
  if (typeof AbortSignal === 'undefined' || typeof AbortSignal.timeout !== 'function') return undefined
  return AbortSignal.timeout(ms)
}

/** AbortSignal.timeout() による中断かどうか。 */
function isTimeoutError(error: unknown): boolean {
  return error instanceof DOMException && (error.name === 'TimeoutError' || error.name === 'AbortError')
}

/**
 * signalを受け取れない呼び出し（apiClientのcallDeviceAuthedFunction）に、
 * AbortSignal.timeout()を使った打ち切りを外側から付ける。
 * 実際の通信自体は中断できないが、UIが応答待ちのまま固まるのは防げる。
 */
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  const signal = timeoutSignal(ms)
  if (!signal) return promise
  const timeout = new Promise<never>((_resolve, reject) => {
    signal.addEventListener('abort', () => reject(signal.reason), { once: true })
  })
  return Promise.race([promise, timeout])
}

// --- 1. 文字起こし ------------------------------------------------------

/**
 * 録音BlobをEdge Function transcribe-audio へmultipartで送り、文字起こしテキストを得る。
 * フィールド名は transcribe-audio 側の form.get('audio') に合わせて 'audio' 固定。
 */
export async function transcribeAudio(blob: Blob, mimeType: string): Promise<string> {
  const formData = new FormData()
  formData.append('audio', blob, `recording.${extensionForMimeType(mimeType)}`)

  let text: string
  try {
    const data = await withTimeout(
      callFlexibleAuthedFunctionWithFormData<{ text?: string }>('transcribe-audio', formData),
      TRANSCRIBE_TIMEOUT_MS,
    )
    text = data.text ?? ''
  } catch (error) {
    throw new VoicePipelineError(
      'transcribe',
      isTimeoutError(error) ? '音声の変換に時間がかかりすぎました' : '音声を文字にできませんでした',
      error,
    )
  }

  if (!text.trim()) {
    throw new VoicePipelineError('transcribe', '声を聞き取れませんでした')
  }
  return text
}

// --- 2. 意図解析 --------------------------------------------------------

interface ProcessVoiceInputData {
  voiceRequestId: string
  interpretedIntent: string
  interpretedPayload: {
    payload?: { title?: unknown; date?: unknown; time?: unknown } | null
    confirmationPrompt?: unknown
  } | null
}

/**
 * 文字起こしテキストから意図（種別・タイトル・日付・時刻）を抽出する。
 * process-voice-input はデバイス認証必須（voice_requestsに本人端末起点として記録するため）なので、
 * デバイス未登録の端末では実行できず、その旨を明示したエラーにする。
 */
export async function extractIntent(transcript: string): Promise<VoiceIntentResult> {
  if (!hasRegisteredDevice()) {
    throw new VoicePipelineError(
      'extract',
      'この端末は本人用として登録されていません',
      new ApiCallError('DEVICE_NOT_REGISTERED', 'この端末は本人用端末として登録されていません', 401),
    )
  }
  return extractIntentViaEdgeFunction(transcript)
}

async function extractIntentViaEdgeFunction(transcript: string): Promise<VoiceIntentResult> {
  let data: ProcessVoiceInputData
  try {
    data = await withTimeout(
      callDeviceAuthedFunction<ProcessVoiceInputData>('process-voice-input', { transcript }),
      EXTRACT_TIMEOUT_MS,
    )
  } catch (error) {
    throw new VoicePipelineError(
      'extract',
      isTimeoutError(error) ? '内容の確認に時間がかかりすぎました' : '内容を確認できませんでした',
      error,
    )
  }

  const intent = asIntent(data.interpretedIntent)
  const payload = data.interpretedPayload?.payload ?? null
  const title = asNullableString(payload?.title)
  const date = asNullableString(payload?.date)
  const time = asNullableString(payload?.time)
  const prompt = asNullableString(data.interpretedPayload?.confirmationPrompt)

  return {
    voiceRequestId: data.voiceRequestId,
    intent,
    title,
    date,
    time,
    confirmationPrompt: prompt ?? buildConfirmationPrompt(intent, title, date, time),
  }
}

// --- 3. 確認結果の送信 --------------------------------------------------

/**
 * ユーザーの「はい」「ちがう」を execute-confirmed-action へ送る。
 * voiceRequestId が null の場合は送信先が無いため何もしない。
 *
 * 注意: execute-confirmed-action は confirmed=true のとき、現状 { status: 'failed',
 * executionResult: { executed: false, reason: 'not_implemented' } } を返す。
 * events/tasks への実書き込みはPhase3スコープのため、これは想定内の正常な戻り値であり、
 * 呼び出し側はエラーとして扱わない。
 */
export async function confirmAction(voiceRequestId: string | null, confirmed: boolean): Promise<void> {
  if (!voiceRequestId) return

  try {
    await callDeviceAuthedFunction('execute-confirmed-action', { voiceRequestId, confirmed })
  } catch (error) {
    // 通信・認証エラーはVoicePipelineErrorに包んで呼び出し側（確認画面）へ渡す。
    console.error('[voicePipeline] execute-confirmed-action failed:', error)
    throw new VoicePipelineError('confirm', '登録の確認を送れませんでした', error)
  }
}
