// AIチャットの会話履歴ユーティリティ（Phase2 ③AI基盤）
// 会話履歴はDBには保存しない（該当テーブルが無く、Phase2のスコープ外）。
// 画面をまたいでも直前の会話が消えないよう、sessionStorage にのみ保存する。

/** 会話履歴の1件。 */
export interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  /** ISO8601文字列。 */
  createdAt: string
}

/** sessionStorage の保存キー。 */
export const CHAT_HISTORY_STORAGE_KEY = 'baba-ai:chat-history'

/** sessionStorage に保持する最大件数（古いものから捨てる）。 */
export const MAX_STORED_MESSAGES = 50

/** APIへ送る直近件数の既定値。 */
export const DEFAULT_SEND_LIMIT = 20

function createId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `msg-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

/** 新しいメッセージを作る（保存はしない）。 */
export function createChatMessage(role: ChatMessage['role'], content: string): ChatMessage {
  return {
    id: createId(),
    role,
    content,
    createdAt: new Date().toISOString(),
  }
}

/** 履歴に1件追加した新しい配列を返す（上限を超えた分は古い順に捨てる）。 */
export function appendMessage(history: ChatMessage[], message: ChatMessage): ChatMessage[] {
  return [...history, message].slice(-MAX_STORED_MESSAGES)
}

/** 直近N件を取り出す。 */
export function takeRecent(history: ChatMessage[], limit: number = DEFAULT_SEND_LIMIT): ChatMessage[] {
  if (limit <= 0) return []
  return history.slice(-limit)
}

function isChatMessage(value: unknown): value is ChatMessage {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<ChatMessage>
  return (
    typeof candidate.id === 'string' &&
    (candidate.role === 'user' || candidate.role === 'assistant') &&
    typeof candidate.content === 'string' &&
    typeof candidate.createdAt === 'string'
  )
}

/** sessionStorage から履歴を読み込む。壊れていれば空配列を返す。 */
export function loadHistory(): ChatMessage[] {
  if (typeof sessionStorage === 'undefined') return []
  try {
    const raw = sessionStorage.getItem(CHAT_HISTORY_STORAGE_KEY)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter(isChatMessage).slice(-MAX_STORED_MESSAGES)
  } catch (error) {
    console.error('[chat] 会話履歴の読み込みに失敗しました:', error)
    return []
  }
}

/** sessionStorage へ履歴を保存する。 */
export function saveHistory(history: ChatMessage[]): void {
  if (typeof sessionStorage === 'undefined') return
  try {
    sessionStorage.setItem(
      CHAT_HISTORY_STORAGE_KEY,
      JSON.stringify(history.slice(-MAX_STORED_MESSAGES)),
    )
  } catch (error) {
    console.error('[chat] 会話履歴の保存に失敗しました:', error)
  }
}

/** sessionStorage の履歴を消す。 */
export function clearHistory(): void {
  if (typeof sessionStorage === 'undefined') return
  try {
    sessionStorage.removeItem(CHAT_HISTORY_STORAGE_KEY)
  } catch (error) {
    console.error('[chat] 会話履歴の削除に失敗しました:', error)
  }
}
