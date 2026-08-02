// ばーばAI 音声認識プロキシサーバー
// OpenAI APIキーをブラウザへ露出させないための最小構成サーバー。
// フロントエンド(Vite)からは /api/* をこのサーバーへプロキシする（vite.config.ts参照）。
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import dotenv from 'dotenv'
import express from 'express'
import multer from 'multer'
import OpenAI from 'openai'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// npm run dev はプロジェクトルートから実行される想定のため、server/.env を明示的に指定して読む。
dotenv.config({ path: path.join(__dirname, '.env') })

const apiKey = process.env.OPENAI_API_KEY
if (!apiKey) {
  console.warn(
    '[server] OPENAI_API_KEY が設定されていません。server/.env.example を参考に server/.env を作成してください。',
  )
}

// APIキー未設定でもサーバー自体は起動できるようにする（各エンドポイントで別途チェックする）。
const openai = new OpenAI({ apiKey: apiKey || 'sk-not-configured' })

const TRANSCRIBE_MODEL = process.env.OPENAI_TRANSCRIBE_MODEL || 'gpt-4o-transcribe'
const EXTRACT_MODEL = process.env.OPENAI_EXTRACT_MODEL || 'gpt-4o-mini'
const PORT = Number(process.env.PORT || 8787)

const app = express()
app.use(express.json({ limit: '2mb' }))

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 },
})

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, configured: Boolean(apiKey) })
})

// 音声ファイル(multipart, フィールド名 "audio") を受け取り、文字起こし結果を返す。
app.post('/api/transcribe', upload.single('audio'), async (req, res) => {
  try {
    if (!apiKey) {
      return res.status(500).json({ error: 'OPENAI_API_KEY is not configured on the server' })
    }
    if (!req.file) {
      return res.status(400).json({ error: 'audio file is required (field name: audio)' })
    }

    const file = await OpenAI.toFile(req.file.buffer, req.file.originalname || 'recording.webm')

    const transcription = await openai.audio.transcriptions.create({
      file,
      model: TRANSCRIBE_MODEL,
      language: 'ja',
    })

    res.json({ text: transcription.text ?? '' })
  } catch (error) {
    console.error('[server] /api/transcribe error:', error)
    res.status(500).json({ error: 'transcription failed' })
  }
})

// 予定登録の意図判定 + 日付・時刻・タイトルの構造化抽出スキーマ。
const INTENT_SCHEMA = {
  type: 'object',
  properties: {
    intent: {
      type: 'string',
      enum: ['register_appointment', 'unknown'],
      description: '予定登録の意図が読み取れれば register_appointment、そうでなければ unknown。',
    },
    title: {
      type: ['string', 'null'],
      description: '予定の内容・用件（例: "病院（内科）"）。読み取れなければ null。',
    },
    date: {
      type: ['string', 'null'],
      description:
        'YYYY-MM-DD形式の絶対日付。「明日」「来週の月曜日」等の相対表現は基準日から計算すること。読み取れなければ null。',
    },
    time: {
      type: ['string', 'null'],
      description: 'HH:MM形式（24時間表記）。読み取れなければ null。',
    },
  },
  required: ['intent', 'title', 'date', 'time'],
  additionalProperties: false,
}

// 文字起こしテキストから意図・日時・タイトルを構造化JSONで抽出する。
app.post('/api/extract-intent', async (req, res) => {
  try {
    if (!apiKey) {
      return res.status(500).json({ error: 'OPENAI_API_KEY is not configured on the server' })
    }
    const text = req.body?.text
    if (!text || typeof text !== 'string' || !text.trim()) {
      return res.status(400).json({ error: 'text is required' })
    }

    const todayJST = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' }) // YYYY-MM-DD

    const response = await openai.responses.create({
      model: EXTRACT_MODEL,
      input: [
        {
          role: 'system',
          content: [
            'あなたは高齢者向け音声予定登録アプリの意図解析器です。',
            'ユーザーの発話（音声を文字起こししたテキスト）から、「予定を登録したい」という意図かどうかを判定し、',
            '日付・時刻・予定のタイトル（用件）を抽出してください。',
            `今日の日付は ${todayJST}（日本時間）です。「明日」「来週の月曜日」等の相対的な表現は、これを基準に絶対日付(YYYY-MM-DD)へ変換してください。`,
            '予定登録の意図でない場合、または内容が予定として読み取れない場合は intent を "unknown" にし、他のフィールドは null にしてください。',
            '予定のタイトルが読み取れれば intent を "register_appointment" としてください。日付や時刻が発話に含まれていなければ、対応するフィールドは null にしてください。',
          ].join('\n'),
        },
        { role: 'user', content: text },
      ],
      text: {
        format: {
          type: 'json_schema',
          name: 'schedule_intent',
          schema: INTENT_SCHEMA,
          strict: true,
        },
      },
    })

    const parsed = JSON.parse(response.output_text)
    res.json(parsed)
  } catch (error) {
    console.error('[server] /api/extract-intent error:', error)
    res.status(500).json({ error: 'intent extraction failed' })
  }
})

app.listen(PORT, () => {
  console.log(`[server] listening on http://localhost:${PORT}`)
})
