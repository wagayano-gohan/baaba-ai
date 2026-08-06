// Edge Functions呼び出し共通ラッパー。
// ばーばAIには2種類の呼び出し主体がある：
//   1. 家族アカウント（owner_admin/viewer） … Supabase AuthのアクセストークンをAuthorization: Bearerで送る
//   2. 本人(principal)端末 … register-deviceで発行されたデバイストークンをx-device-tokenで送る
// 他の担当（音声基盤・AI基盤）もこのファイルの callDeviceAuthedFunction / callUserAuthedFunction を
// 再利用してEdge Functionsを呼び出す想定のため、レスポンス形式・エラー形式をここで共通化する。

import { isSupabaseConfigured, SUPABASE_NOT_CONFIGURED_MESSAGE, supabase } from './supabase'
import { getDeviceToken } from './deviceToken'

// supabase/functions/_shared/errors.ts の ApiErrorBody / ApiSuccessBody と同じ形式。
interface ApiErrorBody {
  error: {
    code: string
    message: string
    details?: unknown
  }
}

interface ApiSuccessBody<T> {
  data: T
}

/**
 * Edge Function呼び出し失敗を表すエラー。
 * `code` は supabase/functions/_shared/errors.ts の ErrorCode 文字列（例: 'PIN_REQUIRED'）。
 * erasableSyntaxOnly設定のためTSの enum は使わず、コード側はサーバーが返す文字列をそのまま利用する。
 */
export class ApiCallError extends Error {
  readonly code: string
  readonly status: number
  readonly details?: unknown

  constructor(code: string, message: string, status: number, details?: unknown) {
    super(message)
    this.name = 'ApiCallError'
    this.code = code
    this.status = status
    this.details = details
  }
}

function ensureConfigured(): void {
  if (!isSupabaseConfigured) {
    throw new Error(SUPABASE_NOT_CONFIGURED_MESSAGE)
  }
}

function functionUrl(name: string): string {
  const base = String(import.meta.env.VITE_SUPABASE_URL ?? '').replace(/\/+$/, '')
  return `${base}/functions/v1/${name}`
}

async function parseResponse<T>(res: Response): Promise<T> {
  let json: unknown
  try {
    json = await res.json()
  } catch {
    throw new ApiCallError(
      'INVALID_RESPONSE',
      'サーバーからの応答を正しく読み取れませんでした',
      res.status,
    )
  }

  if (!res.ok) {
    const body = json as Partial<ApiErrorBody>
    const code = body?.error?.code ?? 'UNKNOWN_ERROR'
    const message = body?.error?.message ?? '通信エラーが発生しました'
    throw new ApiCallError(code, message, res.status, body?.error?.details)
  }

  return (json as ApiSuccessBody<T>).data
}

async function post<T>(name: string, headers: Record<string, string>, body: BodyInit): Promise<T> {
  let res: Response
  try {
    res = await fetch(functionUrl(name), { method: 'POST', headers, body })
  } catch (networkError) {
    throw new ApiCallError(
      'NETWORK_ERROR',
      'サーバーに接続できませんでした。通信環境を確認してください',
      0,
      networkError instanceof Error ? networkError.message : String(networkError),
    )
  }
  return parseResponse<T>(res)
}

async function postJson<T>(name: string, headers: Record<string, string>, body: unknown): Promise<T> {
  return post<T>(name, { 'Content-Type': 'application/json', ...headers }, JSON.stringify(body ?? {}))
}

/**
 * multipart/form-data を送る。
 * Content-Type は境界文字列(boundary)付きでブラウザが自動設定するため、明示的に指定してはならない。
 */
async function postFormData<T>(
  name: string,
  headers: Record<string, string>,
  formData: FormData,
): Promise<T> {
  return post<T>(name, headers, formData)
}

function anonKeyHeader(): Record<string, string> {
  return { apikey: String(import.meta.env.VITE_SUPABASE_ANON_KEY ?? '') }
}

/**
 * 家族アカウント（owner_admin/viewer）としてEdge Functionを呼び出す。
 * 現在のSupabase AuthセッションのアクセストークンをAuthorization: Bearerで送る。
 * 未ログインの場合はUNAUTHENTICATEDのApiCallErrorを投げる。
 */
export async function callUserAuthedFunction<T = unknown>(name: string, body?: unknown): Promise<T> {
  ensureConfigured()

  const { data, error } = await supabase.auth.getSession()
  if (error || !data.session) {
    throw new ApiCallError('UNAUTHENTICATED', 'ログインが必要です', 401)
  }

  return postJson<T>(
    name,
    {
      Authorization: `Bearer ${data.session.access_token}`,
      apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
    },
    body,
  )
}

/**
 * 本人(principal)端末としてEdge Functionを呼び出す。
 * register-deviceで発行され端末に保存済みのデバイストークンをx-device-tokenで送る。
 * 端末未登録の場合はDEVICE_NOT_REGISTEREDのApiCallErrorを投げる。
 */
export async function callDeviceAuthedFunction<T = unknown>(name: string, body?: unknown): Promise<T> {
  ensureConfigured()

  const deviceToken = getDeviceToken()
  if (!deviceToken) {
    throw new ApiCallError('DEVICE_NOT_REGISTERED', 'この端末は本人用端末として登録されていません', 401)
  }

  return postJson<T>(
    name,
    {
      'x-device-token': deviceToken,
      apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
    },
    body,
  )
}

/**
 * 本人端末・家族端末のどちらからでも呼べるEdge Function（transcribe-audio / ai-chat）用の
 * 認証ヘッダを解決する。デバイストークンがあればそれを使い、無ければ家族アカウントのJWTへ
 * フォールバックする。どちらも無い場合はUNAUTHENTICATEDのApiCallErrorを投げる。
 */
async function resolveFlexibleAuthHeaders(): Promise<Record<string, string>> {
  const deviceToken = getDeviceToken()
  if (deviceToken) {
    return { 'x-device-token': deviceToken, ...anonKeyHeader() }
  }

  const { data, error } = await supabase.auth.getSession()
  if (error || !data.session) {
    throw new ApiCallError('UNAUTHENTICATED', 'ログインが必要です', 401)
  }
  return { Authorization: `Bearer ${data.session.access_token}`, ...anonKeyHeader() }
}

/**
 * 本人端末（デバイストークン）優先、無ければ家族アカウント（JWT）としてEdge Functionを呼び出す。
 * 本人端末でも家族端末でも同じ画面（音声・チャット）が動くようにするための共通入口。
 */
export async function callFlexibleAuthedFunction<T = unknown>(name: string, body?: unknown): Promise<T> {
  ensureConfigured()
  return postJson<T>(name, await resolveFlexibleAuthHeaders(), body)
}

/**
 * callFlexibleAuthedFunction の multipart/form-data 版（音声ファイル送信用）。
 * Content-Type はブラウザに自動設定させるため、ここでは指定しない。
 */
export async function callFlexibleAuthedFunctionWithFormData<T = unknown>(
  name: string,
  formData: FormData,
): Promise<T> {
  ensureConfigured()
  return postFormData<T>(name, await resolveFlexibleAuthHeaders(), formData)
}
