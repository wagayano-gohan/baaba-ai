// ai-chat: 会話履歴を受け取り、OpenAI Responses APIでAIの返答テキストを返す。
// PCのローカルサーバー(server/chatRoutes.js の /api/chat)への依存を排除するためのクラウド版。
//
// 呼び出し元は2種類ある（どちらか一方の認証が通ればよい）:
//   1. 本人(principal)端末 … x-device-token（register-deviceで払い出した生トークン）
//   2. 家族アカウント(owner_admin/viewer) … Authorization: Bearer <JWT>
// 本人端末はJWTを持たないため config.toml で verify_jwt = false とし、認証はこのFunction内で行う。
//
// リクエスト: { messages: Array<{ role: 'user' | 'assistant', content: string }>, systemPrompt?: string }
// レスポンス: jsonSuccess({ text })
//
// 必要なSupabase Secrets:
//   - OPENAI_API_KEY    … OpenAI APIキー（必須。未設定時は500）
//   - OPENAI_CHAT_MODEL … チャットに使うモデル名。未設定時は 'gpt-4o-mini'

import { handlePreflight } from '../_shared/cors.ts'
import { jsonError, jsonSuccess, ErrorCode } from '../_shared/errors.ts'
import { getAuthContext, getDeviceAuthContext } from '../_shared/auth.ts'
import { createServiceRoleClient } from '../_shared/supabaseClient.ts'

const OPENAI_RESPONSES_URL = 'https://api.openai.com/v1/responses'

// 送信するメッセージ数の上限（直近のみを送る）。
const MAX_MESSAGES = 20

// クライアントから systemPrompt が渡されなかった場合に使うサーバー側の既定プロンプト。
const DEFAULT_SYSTEM_PROMPT = [
  'あなたは高齢者の方の暮らしを支える話し相手AI「ばーばAI」です。',
  'やさしく、ていねいな日本語で答えてください。',
  '一文は短くし、むずかしい言葉やカタカナの専門用語は使わないでください。',
  '答えは長くしすぎず、大切なことから先に伝えてください。',
  'わからないことは「わかりません」と正直に伝えてください。推測で決めつけないでください。',
  '薬・病気・お金に関することは、自分で判断せず、ご家族やお医者さん、専門の方に相談するようにすすめてください。',
].join('\n')

interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
}

/** 受け取ったメッセージ配列を、role/content が正しいものだけに整えて直近N件へ切り詰める。 */
function normalizeMessages(messages: unknown): ChatMessage[] {
  if (!Array.isArray(messages)) return []
  return messages
    .filter((message: unknown) => {
      const item = message as { role?: unknown; content?: unknown } | null
      return (
        !!item &&
        (item.role === 'user' || item.role === 'assistant') &&
        typeof item.content === 'string' &&
        item.content.trim() !== ''
      )
    })
    .slice(-MAX_MESSAGES)
    .map((message: unknown) => {
      const item = message as { role: 'user' | 'assistant'; content: string }
      return { role: item.role, content: item.content }
    })
}

/** 本人デバイス認証か家族JWT認証のどちらかが通れば true。 */
async function isAuthorized(req: Request): Promise<boolean> {
  try {
    if (req.headers.get('x-device-token')) {
      const serviceClient = createServiceRoleClient()
      if (await getDeviceAuthContext(req, serviceClient)) return true
    }
  } catch (error) {
    console.error('[ai-chat] デバイス認証の確認に失敗しました:', error)
  }

  try {
    if (await getAuthContext(req)) return true
  } catch (error) {
    console.error('[ai-chat] JWT認証の確認に失敗しました:', error)
  }

  return false
}

/**
 * Web検索の根拠となったURLを取り出す。
 * Responses APIは本文中の該当箇所に annotations（url_citation）を付けて返すため、
 * それを収集して重複を除いた一覧にする。
 * 画面には表示しないが、「AIが何を根拠に答えたか」を後から検証できるようにレスポンスへ含める。
 */
function extractSources(json: unknown): { url: string; title: string }[] {
  const body = json as { output?: unknown }
  const output = Array.isArray(body?.output) ? body.output : []
  const seen = new Set<string>()
  const sources: { url: string; title: string }[] = []

  for (const item of output) {
    const contents = (item as { content?: unknown })?.content
    if (!Array.isArray(contents)) continue
    for (const content of contents) {
      const annotations = (content as { annotations?: unknown })?.annotations
      if (!Array.isArray(annotations)) continue
      for (const annotation of annotations) {
        const a = annotation as { type?: unknown; url?: unknown; title?: unknown }
        if (a?.type !== 'url_citation' || typeof a.url !== 'string' || a.url === '') continue
        if (seen.has(a.url)) continue
        seen.add(a.url)
        sources.push({ url: a.url, title: typeof a.title === 'string' ? a.title : '' })
      }
    }
  }
  return sources
}

/** Responses APIの出力からテキストを取り出す（output_textはSDK側の便宜プロパティのため両対応）。 */
function extractOutputText(json: unknown): string {
  const body = json as { output_text?: unknown; output?: unknown }
  if (typeof body?.output_text === 'string' && body.output_text !== '') return body.output_text

  const output = Array.isArray(body?.output) ? body.output : []
  for (const item of output) {
    const contents = (item as { content?: unknown })?.content
    if (!Array.isArray(contents)) continue
    for (const content of contents) {
      const text = (content as { text?: unknown })?.text
      if (typeof text === 'string' && text !== '') return text
    }
  }
  return ''
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
    console.error('[ai-chat] OPENAI_API_KEYが未設定です')
    return jsonError(ErrorCode.INTERNAL_ERROR, 'AIチャットの設定が完了していません', 500)
  }
  const model = Deno.env.get('OPENAI_CHAT_MODEL') ?? 'gpt-4o-mini'

  let body: { messages?: unknown; systemPrompt?: unknown }
  try {
    body = await req.json()
  } catch {
    return jsonError(ErrorCode.INVALID_JSON, 'リクエストボディがJSONとして不正です', 400)
  }

  const history = normalizeMessages(body?.messages)
  if (history.length === 0) {
    return jsonError(ErrorCode.VALIDATION_ERROR, 'messagesには1件以上の有効なメッセージが必要です', 400)
  }

  const systemPrompt =
    typeof body?.systemPrompt === 'string' && body.systemPrompt.trim() !== ''
      ? body.systemPrompt
      : DEFAULT_SYSTEM_PROMPT

  let res: Response
  try {
    res = await fetch(OPENAI_RESPONSES_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        input: [{ role: 'system', content: systemPrompt }, ...history],
        // ばーばAIは「調べ方を教えるAI」ではなく「本人の代わりに調べて具体的な候補を出す
        // 生活コンシェルジュ」である。病院・店舗・営業時間などは最新情報が必要で、
        // モデルの学習データだけでは答えられないため、Web検索ツールを常時有効にする。
        tools: [{ type: 'web_search' }],
      }),
    })
  } catch (error) {
    console.error('[ai-chat] OpenAIへの接続に失敗しました:', error)
    return jsonError(ErrorCode.EXTERNAL_API_ERROR, 'お返事を用意できませんでした', 502)
  }

  if (!res.ok) {
    console.error('[ai-chat] OpenAI API error:', res.status, await res.text())
    return jsonError(ErrorCode.EXTERNAL_API_ERROR, 'お返事を用意できませんでした', 502)
  }

  let text = ''
  let sources: { url: string; title: string }[] = []
  try {
    const json = await res.json()
    text = extractOutputText(json)
    sources = extractSources(json)
  } catch (error) {
    console.error('[ai-chat] OpenAIレスポンスの解析に失敗しました:', error)
    return jsonError(ErrorCode.EXTERNAL_API_ERROR, 'お返事を読み取れませんでした', 502)
  }

  // 検証用にサーバーログへも残す（画面には出さない）。新規テーブルは追加しない。
  if (sources.length > 0) {
    console.info('[ai-chat] sources:', JSON.stringify(sources))
  }

  return jsonSuccess({ text, sources })
})
