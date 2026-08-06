// ばーばAI AIチャット用ルーター（Phase2 ③AI基盤）
// OpenAI APIキーをブラウザへ露出させないため、チャットも必ずこのサーバー経由で呼び出す。
// server/index.js 側で `app.use(chatRouter)` としてマウントされる想定。
import express from 'express'
import OpenAI from 'openai'

export const chatRouter = express.Router()

// index.js 側で express.json() が先に適用されている場合、body-parser は req._body を見て
// 二重パースをスキップするため、マウント順に依存せず動くようここでも明示しておく。
chatRouter.use(express.json({ limit: '1mb' }))

// クライアントから systemPrompt が渡されなかった場合に使うサーバー側の既定プロンプト。
const DEFAULT_SYSTEM_PROMPT = [
  'あなたは高齢者の方の暮らしを支える話し相手AI「ばーばAI」です。',
  'やさしく、ていねいな日本語で答えてください。',
  '一文は短くし、むずかしい言葉やカタカナの専門用語は使わないでください。',
  '答えは長くしすぎず、大切なことから先に伝えてください。',
  'わからないことは「わかりません」と正直に伝えてください。推測で決めつけないでください。',
  '薬・病気・お金に関することは、自分で判断せず、ご家族やお医者さん、専門の方に相談するようにすすめてください。',
].join('\n')

// 送信するメッセージ数の上限（直近のみを送る）。
const MAX_MESSAGES = 20

/** 受け取ったメッセージ配列を、role/content が正しいものだけに整えて直近N件へ切り詰める。 */
function normalizeMessages(messages) {
  return messages
    .filter(
      (message) =>
        message &&
        (message.role === 'user' || message.role === 'assistant') &&
        typeof message.content === 'string' &&
        message.content.trim() !== '',
    )
    .slice(-MAX_MESSAGES)
    .map((message) => ({ role: message.role, content: message.content }))
}

// 会話履歴を受け取り、AIの返答テキストを返す。
chatRouter.post('/api/chat', async (req, res) => {
  try {
    // dotenv.config() は index.js の import 巻き上げより後に実行されるため、
    // APIキーの読み取りとOpenAIクライアントの生成はモジュールトップレベルではなくここで行う。
    const apiKey = process.env.OPENAI_API_KEY
    if (!apiKey) {
      return res.status(500).json({ error: 'OPENAI_API_KEY is not configured on the server' })
    }

    const messages = req.body?.messages
    if (!Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ error: 'messages is required (non-empty array)' })
    }

    const history = normalizeMessages(messages)
    if (history.length === 0) {
      return res.status(400).json({ error: 'messages must contain at least one valid message' })
    }

    const systemPrompt =
      typeof req.body?.systemPrompt === 'string' && req.body.systemPrompt.trim()
        ? req.body.systemPrompt
        : DEFAULT_SYSTEM_PROMPT

    const openai = new OpenAI({ apiKey })
    const model = process.env.OPENAI_CHAT_MODEL || 'gpt-4o-mini'

    const response = await openai.responses.create({
      model,
      input: [{ role: 'system', content: systemPrompt }, ...history],
    })

    res.json({ text: response.output_text ?? '' })
  } catch (error) {
    console.error('[server] /api/chat error:', error)
    res.status(500).json({ error: 'chat failed' })
  }
})
