// transcribe-audio: 録音音声をOpenAIで文字起こしし、{ text } を返す。
// PCのローカルサーバー(server/index.js の /api/transcribe)への依存を排除するためのクラウド版。
//
// 呼び出し元は2種類ある（どちらか一方の認証が通ればよい）:
//   1. 本人(principal)端末 … register-deviceで払い出した生トークンを x-device-token で提示する。
//   2. 家族アカウント(owner_admin/viewer) … Supabase Authのアクセストークンを Authorization: Bearer で提示する。
// 本人端末はJWTを持たないため config.toml で verify_jwt = false とし、認証はこのFunction内で行う。
//
// リクエスト: multipart/form-data、フィールド名 'audio'（Blob/File）。
// レスポンス: jsonSuccess({ text })
//
// 必要なSupabase Secrets:
//   - OPENAI_API_KEY           … OpenAI APIキー（必須。未設定時は500）
//   - OPENAI_TRANSCRIBE_MODEL  … 文字起こしモデル名。未設定時は 'gpt-4o-transcribe'

import { handlePreflight } from '../_shared/cors.ts'
import { jsonError, jsonSuccess, ErrorCode } from '../_shared/errors.ts'
import { getAuthContext, getDeviceAuthContext } from '../_shared/auth.ts'
import { createServiceRoleClient } from '../_shared/supabaseClient.ts'

const OPENAI_TRANSCRIPTIONS_URL = 'https://api.openai.com/v1/audio/transcriptions'

// OpenAIの音声ファイルサイズ上限（25MB）に合わせる。
const MAX_AUDIO_BYTES = 25 * 1024 * 1024

/** 本人デバイス認証か家族JWT認証のどちらかが通れば true。 */
async function isAuthorized(req: Request): Promise<boolean> {
  // 1. 本人デバイス（x-device-token）。service roleクライアントが必要。
  try {
    if (req.headers.get('x-device-token')) {
      const serviceClient = createServiceRoleClient()
      if (await getDeviceAuthContext(req, serviceClient)) return true
    }
  } catch (error) {
    console.error('[transcribe-audio] デバイス認証の確認に失敗しました:', error)
  }

  // 2. 家族アカウント（Authorization: Bearer <JWT>）。
  try {
    if (await getAuthContext(req)) return true
  } catch (error) {
    console.error('[transcribe-audio] JWT認証の確認に失敗しました:', error)
  }

  return false
}

Deno.serve(async (req) => {
  const preflight = handlePreflight(req)
  if (preflight) return preflight

  if (req.method !== 'POST') {
    return jsonError(ErrorCode.METHOD_NOT_ALLOWED, 'POSTのみ許可されています', 405)
  }

  if (!(await isAuthorized(req))) {
    return jsonError(ErrorCode.UNAUTHENTICATED, '認証情報が無効です', 401)
  }

  const apiKey = Deno.env.get('OPENAI_API_KEY')
  if (!apiKey) {
    console.error('[transcribe-audio] OPENAI_API_KEYが未設定です')
    return jsonError(ErrorCode.INTERNAL_ERROR, '文字起こしの設定が完了していません', 500)
  }
  const model = Deno.env.get('OPENAI_TRANSCRIBE_MODEL') ?? 'gpt-4o-transcribe'

  // multipart/form-data から音声ファイルを取り出す。
  let form: FormData
  try {
    form = await req.formData()
  } catch (error) {
    console.error('[transcribe-audio] formDataの読み取りに失敗しました:', error)
    return jsonError(ErrorCode.VALIDATION_ERROR, '音声データを受け取れませんでした', 400)
  }

  const audio = form.get('audio')
  if (!(audio instanceof File)) {
    return jsonError(ErrorCode.VALIDATION_ERROR, 'audioフィールドに音声ファイルが必要です', 400)
  }
  if (audio.size === 0) {
    return jsonError(ErrorCode.VALIDATION_ERROR, '音声データが空です', 400)
  }
  if (audio.size > MAX_AUDIO_BYTES) {
    return jsonError(ErrorCode.FILE_TOO_LARGE, '音声が長すぎます。短く区切ってお話しください', 400)
  }

  // OpenAIへmultipartのまま転送する（Content-Typeはfetchが境界文字列付きで自動設定するため指定しない）。
  const upstreamForm = new FormData()
  upstreamForm.append('file', audio, audio.name !== '' ? audio.name : 'recording.webm')
  upstreamForm.append('model', model)
  upstreamForm.append('language', 'ja')

  let res: Response
  try {
    res = await fetch(OPENAI_TRANSCRIPTIONS_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}` },
      body: upstreamForm,
    })
  } catch (error) {
    console.error('[transcribe-audio] OpenAIへの接続に失敗しました:', error)
    return jsonError(ErrorCode.EXTERNAL_API_ERROR, '音声を文字にできませんでした', 502)
  }

  if (!res.ok) {
    console.error('[transcribe-audio] OpenAI API error:', res.status, await res.text())
    return jsonError(ErrorCode.EXTERNAL_API_ERROR, '音声を文字にできませんでした', 502)
  }

  let text = ''
  try {
    const json = await res.json()
    text = typeof json?.text === 'string' ? json.text : ''
  } catch (error) {
    console.error('[transcribe-audio] OpenAIレスポンスの解析に失敗しました:', error)
    return jsonError(ErrorCode.EXTERNAL_API_ERROR, '音声の変換結果を読み取れませんでした', 502)
  }

  return jsonSuccess({ text })
})
