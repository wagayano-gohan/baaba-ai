// AIチャットのAPIクライアント（Phase2 ③AI基盤）
// OpenAI APIキーをブラウザへ露出させないため、必ず Edge Function ai-chat 経由で呼ぶ。
// PCのローカルサーバー(/api/chat)には依存しない。
// 本人端末（デバイストークン）でも家族端末（JWT）でも呼べるよう callFlexibleAuthedFunction を使う。

import { ApiCallError, callFlexibleAuthedFunction } from '../apiClient'
import { DEFAULT_SEND_LIMIT, takeRecent } from './conversation'
import type { ChatMessage } from './conversation'
import { sanitizeAnswerText } from './sanitize'

const CHAT_FUNCTION_NAME = 'ai-chat'

const NETWORK_ERROR_MESSAGE = 'サーバーに接続できませんでした。通信環境をご確認のうえ、もう一度お試しください'
const SERVER_ERROR_MESSAGE = '回答を取得できませんでした。もう一度お試しください'
const EMPTY_ANSWER_MESSAGE = '回答を受け取れませんでした。もう一度お試しください'

interface ChatResponseData {
  text?: string
}

/**
 * 会話履歴を送り、AIの返答テキストを受け取る。
 * 送るのは直近 DEFAULT_SEND_LIMIT 件のみ（サーバー側でも同様に切り詰める）。
 */
export async function sendChatMessage(
  history: ChatMessage[],
  systemPrompt: string,
): Promise<string> {
  const messages = takeRecent(history, DEFAULT_SEND_LIMIT).map((message) => ({
    role: message.role,
    content: message.content,
  }))

  let data: ChatResponseData
  try {
    data = await callFlexibleAuthedFunction<ChatResponseData>(CHAT_FUNCTION_NAME, {
      messages,
      systemPrompt,
    })
  } catch (error) {
    console.error('[chat] ai-chat の呼び出しに失敗しました:', error)
    if (error instanceof ApiCallError && error.code === 'NETWORK_ERROR') {
      throw new Error(NETWORK_ERROR_MESSAGE)
    }
    throw new Error(SERVER_ERROR_MESSAGE)
  }

  const raw = typeof data.text === 'string' ? data.text.trim() : ''
  if (!raw) {
    throw new Error(EMPTY_ANSWER_MESSAGE)
  }

  // system promptでURL・マークダウンの使用を禁止しているが、モデルが従わない場合に備えて
  // 表示直前にも取り除く（二重の担保）。根拠URLは Edge Function 側が sources として保持済み。
  const text = sanitizeAnswerText(raw)
  if (!text) {
    throw new Error(EMPTY_ANSWER_MESSAGE)
  }

  return text
}
