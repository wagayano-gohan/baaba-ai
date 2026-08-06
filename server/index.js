// ばーばAI 音声認識プロキシサーバー
// OpenAI APIキーをブラウザへ露出させないための最小構成サーバー。
// フロントエンド(Vite)からは /api/* をこのサーバーへプロキシする（vite.config.ts参照）。
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import dotenv from 'dotenv'
import express from 'express'
import multer from 'multer'
import OpenAI from 'openai'
import { chatRouter } from './chatRoutes.js'

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

// AIチャット用ルート（server/chatRoutes.js。実装はAIチャット担当）。
app.use(chatRouter)

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

// 予定/やること登録の意図判定 + 日付・時刻・タイトルの構造化抽出スキーマ。
// 意図は supabase/functions/process-voice-input と同一の確定スキーマ
// （create_event / create_task / ambiguous / unknown）に揃える。
const INTENT_SCHEMA = {
  type: 'object',
  properties: {
    intent: {
      type: 'string',
      enum: ['create_event', 'create_task', 'ambiguous', 'unknown'],
      description:
        'カレンダーに載せる予定なら create_event、完了を管理する行動（やること）なら create_task、' +
        'どちらか判別できない場合は ambiguous、予定・やることの登録意図でない場合は unknown。日時の有無では判定しない。',
    },
    title: {
      type: ['string', 'null'],
      description: '予定・やることの内容（例: "病院（内科）"）。読み取れなければ null。',
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
            'あなたは高齢者向け音声アシスタント「ばーばAI」の意図解析器です。',
            'ユーザーの発話（音声を文字起こししたテキスト）から、「予定(create_event)」か「やること(create_task)」かを判定し、',
            '内容（タイトル）・日付・時刻を抽出してください。',
            `今日の日付は ${todayJST}（日本時間）です。「明日」「あさって」「来週の月曜日」等の相対的な表現は、これを基準に絶対日付(YYYY-MM-DD)へ変換してください。`,
            '【判定基準】日時が含まれているかどうかでは判定しません。「カレンダー上の予定」なのか「完了を管理する行動」なのかで判定してください。',
            'create_event（予定）… カレンダーに載せる予定。例: 病院、歯医者、会食、通院、外出予定、薬の予定、ゴミの日、記念日、指定時刻のリマインダー。',
            'create_task（やること）… 完了チェックを目的とする行動。例: やること、買い物メモ、忘れ物チェック、期限付きToDo。',
            'やることは期限(due_at)を持つ場合があります。期限や日時が伴っていても、行動の完了を管理するものは create_task です。',
            '予定なのかやることなのか判別できない場合は、どちらかに決めつけず intent を "ambiguous" にしてください。タイトル・日付・時刻は読み取れた範囲で出力してください。',
            'そもそも予定・やることの登録意図でない場合、または内容が読み取れない場合は intent を "unknown" にし、他のフィールドはすべて null にしてください。',
            '発話に含まれていない日付・時刻は推測せず null にしてください。時刻は24時間表記のHH:MM形式で出力してください。',
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
