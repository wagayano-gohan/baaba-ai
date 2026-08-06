import { corsHeaders } from './cors.ts'
import type { ApiErrorBody, ApiSuccessBody } from './types.ts'

// エラーコード一覧。クライアント側の分岐・表示文言決定に使用する想定。
// 新しいエラーケースを追加する場合は必ずここに定義を追加すること。
export enum ErrorCode {
  // 認証・認可
  UNAUTHENTICATED = 'UNAUTHENTICATED',
  INVALID_TOKEN = 'INVALID_TOKEN',
  FORBIDDEN = 'FORBIDDEN',
  PROFILE_ACCESS_DENIED = 'PROFILE_ACCESS_DENIED',
  ROLE_NOT_ALLOWED = 'ROLE_NOT_ALLOWED',
  /**
   * JWT自体は有効だが session_id クレームが取得できず、
   * PIN確認セッション（auth_user_id + auth_session_id）を特定できない場合に使用する。
   * user.id で代用すると別端末・別セッションのPIN確認状態を共有してしまうため、必ず拒否する。
   */
  AUTH_SESSION_ID_MISSING = 'AUTH_SESSION_ID_MISSING',

  // PIN（owner_admin重要操作）
  PIN_REQUIRED = 'PIN_REQUIRED',
  PIN_INVALID = 'PIN_INVALID',
  PIN_LOCKED = 'PIN_LOCKED',
  PIN_NOT_SET = 'PIN_NOT_SET',
  PIN_SESSION_EXPIRED = 'PIN_SESSION_EXPIRED',

  // 入力バリデーション
  VALIDATION_ERROR = 'VALIDATION_ERROR',
  METHOD_NOT_ALLOWED = 'METHOD_NOT_ALLOWED',
  INVALID_JSON = 'INVALID_JSON',

  // リソース
  NOT_FOUND = 'NOT_FOUND',
  ALREADY_EXISTS = 'ALREADY_EXISTS',
  CONFLICT = 'CONFLICT',

  // 招待
  INVITATION_INVALID = 'INVITATION_INVALID',
  INVITATION_EXPIRED = 'INVITATION_EXPIRED',
  INVITATION_ALREADY_ACCEPTED = 'INVITATION_ALREADY_ACCEPTED',
  INVITATION_REVOKED = 'INVITATION_REVOKED',
  INVITATION_EMAIL_MISMATCH = 'INVITATION_EMAIL_MISMATCH',

  // デバイス（本人=principal）
  DEVICE_NOT_REGISTERED = 'DEVICE_NOT_REGISTERED',
  DEVICE_ALREADY_REGISTERED = 'DEVICE_ALREADY_REGISTERED',
  DEVICE_AUTH_INVALID = 'DEVICE_AUTH_INVALID',
  DEVICE_PAIRING_CODE_INVALID = 'DEVICE_PAIRING_CODE_INVALID',
  /**
   * 旧方式（Supabase Auth再認証から5分以内を要求する方式）用のコード。
   * 重要操作の再認証は管理者PIN確認セッション(PIN_REQUIRED)に一本化されたため現在は未使用。
   * クライアント側の後方互換のため定義のみ残す。新規実装で使用しないこと。
   */
  RECENT_REAUTH_REQUIRED = 'RECENT_REAUTH_REQUIRED',

  // ファイルアップロード（notes-images）
  FILE_TOO_LARGE = 'FILE_TOO_LARGE',
  FILE_TYPE_INVALID = 'FILE_TYPE_INVALID',
  UPLOAD_NOT_FOUND = 'UPLOAD_NOT_FOUND',
  UPLOAD_MIME_MISMATCH = 'UPLOAD_MIME_MISMATCH',

  // 音声リクエスト
  VOICE_REQUEST_NOT_FOUND = 'VOICE_REQUEST_NOT_FOUND',
  VOICE_REQUEST_ALREADY_HANDLED = 'VOICE_REQUEST_ALREADY_HANDLED',

  // レート制限
  RATE_LIMITED = 'RATE_LIMITED',
  WEATHER_RATE_LIMITED = 'WEATHER_RATE_LIMITED',

  // 外部API
  EXTERNAL_API_ERROR = 'EXTERNAL_API_ERROR',

  // その他
  INTERNAL_ERROR = 'INTERNAL_ERROR',
  /** ロジックが未実装のため安全側に倒して即座に失敗させる場合に使用する（危険な仮実装での通過を防ぐ） */
  NOT_IMPLEMENTED = 'NOT_IMPLEMENTED',
}

export function jsonError(code: ErrorCode, message: string, status = 400, details?: unknown): Response {
  const body: ApiErrorBody = { error: { code, message, details } }
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

export function jsonSuccess<T>(data: T, status = 200): Response {
  const body: ApiSuccessBody<T> = { data }
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}
