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
 * 扱う意図の種別。サーバー（process-voice-input）の列挙と対応する。
 *   - ambiguous … 予定（create_event）かやること（create_task）か判別できない場合。
 *                 勝手に保存せず、confirmationPrompt でユーザーに聞き返す。
 *   - unknown   … そもそも意図が読み取れない場合。
 */
export type VoiceIntent =
  | 'create_event'
  | 'create_task'
  | 'add_shopping'
  | 'complete_task'
  | 'take_medication'
  | 'add_medication'
  | 'add_delivery'
  | 'set_garbage'
  | 'add_contact'
  | 'call_contact'
  | 'add_location'
  | 'query_schedule'
  | 'query_shopping'
  | 'query_garbage'
  | 'query_medication'
  | 'ambiguous'
  | 'unknown'

/**
 * 応答の種類。
 *   - confirm  … 「はい」で登録・記録する。
 *   - question … 足りない情報を1つだけ聞き返している。続けて話してもらう。
 *   - answer   … その場で答えるだけ（登録は伴わない）。
 */
export type VoiceMode = 'confirm' | 'question' | 'answer'

export interface VoiceIntentResult {
  /** process-voice-input で採番される voice_requests のID。 */
  voiceRequestId: string | null
  intent: VoiceIntent
  mode: VoiceMode
  title: string | null
  /** YYYY-MM-DD */
  date: string | null
  /** HH:MM（24時間表記） */
  time: string | null
  /** 画面と読み上げで使う確認・質問・回答の文言。 */
  confirmationPrompt: string
  /** 電話をかける相手が特定できた場合の番号（call_contact）。 */
  phoneNumber: string | null
  /** 聞き返し済みの項目。次の発話と一緒に送り返す。 */
  asked: string[]
}

/** 聞き返しに答えてもらうときに引き継ぐ内容。 */
export interface VoiceFollowUp {
  /** ここまでの発話（新しい発話と結合してもう一度解析する）。 */
  transcript: string
  asked: string[]
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

const INTENTS: VoiceIntent[] = [
  'create_event',
  'create_task',
  'add_shopping',
  'complete_task',
  'take_medication',
  'add_medication',
  'add_delivery',
  'set_garbage',
  'add_contact',
  'call_contact',
  'add_location',
  'query_schedule',
  'query_shopping',
  'query_garbage',
  'query_medication',
  'ambiguous',
]

function asIntent(value: unknown): VoiceIntent {
  return INTENTS.includes(value as VoiceIntent) ? (value as VoiceIntent) : 'unknown'
}

function asMode(value: unknown): VoiceMode {
  return value === 'confirm' || value === 'question' || value === 'answer' ? value : 'answer'
}

function asNullableString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value : null
}

const UNKNOWN_PROMPT = '内容を確認できませんでした。もう一度お話しください。'

/** 聞き返しへの答えを、前の発話とつなげた1本のテキストにする。 */
export function mergeTranscript(followUp: VoiceFollowUp | null | undefined, transcript: string): string {
  return followUp ? `${followUp.transcript}\n${transcript}` : transcript
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
    payload?: Record<string, unknown> | null
    confirmationPrompt?: unknown
    mode?: unknown
    asked?: unknown
  } | null
}

/**
 * 文字起こしテキストから意図を抽出する。
 * followUp を渡した場合は、前の発話と結合して解析し直す（聞き返しへの答えを反映するため）。
 * process-voice-input はデバイス認証必須（voice_requestsに本人端末起点として記録するため）なので、
 * デバイス未登録の端末では実行できず、その旨を明示したエラーにする。
 */
export async function extractIntent(
  transcript: string,
  followUp?: VoiceFollowUp | null,
): Promise<VoiceIntentResult> {
  if (!hasRegisteredDevice()) {
    throw new VoicePipelineError(
      'extract',
      'この端末は本人用として登録されていません',
      new ApiCallError('DEVICE_NOT_REGISTERED', 'この端末は本人用端末として登録されていません', 401),
    )
  }
  return extractIntentViaEdgeFunction(transcript, followUp ?? null)
}

async function extractIntentViaEdgeFunction(
  transcript: string,
  followUp: VoiceFollowUp | null,
): Promise<VoiceIntentResult> {
  // 聞き返しへの答えは、前の発話とつなげて解析する（会話の文脈を保つ最小の方法）。
  const merged = mergeTranscript(followUp, transcript)

  let data: ProcessVoiceInputData
  try {
    data = await withTimeout(
      callDeviceAuthedFunction<ProcessVoiceInputData>('process-voice-input', {
        transcript: merged,
        asked: followUp?.asked ?? [],
      }),
      EXTRACT_TIMEOUT_MS,
    )
  } catch (error) {
    throw new VoicePipelineError(
      'extract',
      isTimeoutError(error) ? '内容の確認に時間がかかりすぎました' : '内容を確認できませんでした',
      error,
    )
  }

  const payload = data.interpretedPayload?.payload ?? null
  const rawAsked = data.interpretedPayload?.asked
  const prompt = asNullableString(data.interpretedPayload?.confirmationPrompt)

  return {
    voiceRequestId: data.voiceRequestId,
    intent: asIntent(data.interpretedIntent),
    mode: asMode(data.interpretedPayload?.mode),
    title: asNullableString(payload?.title),
    date: asNullableString(payload?.date),
    time: asNullableString(payload?.time),
    confirmationPrompt: prompt ?? UNKNOWN_PROMPT,
    phoneNumber: asNullableString(payload?.phoneNumber),
    asked: Array.isArray(rawAsked) ? rawAsked.filter((item): item is string => typeof item === 'string') : [],
  }
}

// --- 3. 確認結果の送信 --------------------------------------------------

/**
 * ユーザーの「はい」「ちがう」を execute-confirmed-action へ送る。
 * voiceRequestId が null の場合は送信先が無いため何もしない。
 * intent は、予定かやることか判別できなかった（ambiguous）ときに画面で選ばれた種別。
 */
export async function confirmAction(
  voiceRequestId: string | null,
  confirmed: boolean,
  intent?: string,
): Promise<void> {
  if (!voiceRequestId) return

  try {
    await callDeviceAuthedFunction('execute-confirmed-action', { voiceRequestId, confirmed, intent })
  } catch (error) {
    // 通信・認証エラーはVoicePipelineErrorに包んで呼び出し側（確認画面）へ渡す。
    console.error('[voicePipeline] execute-confirmed-action failed:', error)
    throw new VoicePipelineError('confirm', '登録の確認を送れませんでした', error)
  }
}
