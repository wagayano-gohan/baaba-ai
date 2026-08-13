// process-voice-input: ご本人の発話から意図を解析し、
//   - 確認して登録するもの（confirm）
//   - 足りない情報を1つだけ聞き返すもの（question）
//   - その場で答えるだけのもの（answer）
// のいずれかを組み立てて返す。voice_requests への記録も行う。
//
// 呼び出し元: 本人(principal)のデバイス。メール・パスワード・PINを使わないため、
// register-deviceで払い出された生トークンによるデバイス認証(x-device-token)を使用する。
//
// 設計方針:
//   ご本人は「話しかけるだけ」で日常の登録・記録・参照を完結できることを最優先とする。
//   ご家族の管理画面での事前設定は前提にしない（ゴミの日・お薬・連絡先・場所も声で登録できる）。
//
// 正式確定仕様:
//   - source は 'principal_voice' | 'family' | 'system' のみ許可。本人デバイス起点のため 'principal_voice'。
//   - raw_transcript（raw_textではない）。
//   - status は 'received' | 'confirmed' | 'executed' | 'rejected' | 'failed'。
//   - interpreted_intent / interpreted_payload（parsed_actionは存在しない）。
//
// 必要なSupabase Secrets:
//   - OPENAI_API_KEY       … OpenAI APIキー。未設定でも動作するが、意図は常に'unknown'になる。
//   - OPENAI_EXTRACT_MODEL … 意図解析に使うモデル名。未設定時は 'gpt-4o-mini'。

import { handlePreflight } from '../_shared/cors.ts'
import { jsonError, jsonSuccess, ErrorCode } from '../_shared/errors.ts'
import { getDeviceAuthContext } from '../_shared/auth.ts'
import { createServiceRoleClient } from '../_shared/supabaseClient.ts'
import { nowUtcIso, todayJstDateString, jstDateToUtcIso } from '../_shared/datetime.ts'

interface ProcessVoiceInputRequest {
  transcript: string
  /** 既に聞き返した項目。同じことを何度も聞かないために使う。 */
  asked?: string[]
}

/**
 * 扱う意図。登録系・記録系・参照系を1つの列挙で表す。
 *   - ambiguous … 予定かやることか判別できない場合。ユーザーに聞き返す。
 *   - unknown   … そもそも意図が読み取れない場合。
 */
type VoiceIntent =
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
  'unknown',
]

interface ExtractedIntent {
  intent: VoiceIntent
  title: string | null
  date: string | null
  time: string | null
  weekday: number | null
  dosage: string | null
  phone: string | null
  memo: string | null
}

const UNKNOWN_EXTRACTION: ExtractedIntent = {
  intent: 'unknown',
  title: null,
  date: null,
  time: null,
  weekday: null,
  dosage: null,
  phone: null,
  memo: null,
}

const UNKNOWN_PROMPT = '内容を確認できませんでした。もう一度お話しください。'
const AMBIGUOUS_PROMPT = '予定として登録しますか？ やることとして登録しますか？'

const WEEKDAY_KANJI = ['日', '月', '火', '水', '木', '金', '土']

/** 服薬の予定を一度に作る日数（家族画面の既定と揃える）。 */
const MEDICATION_DAYS = 30

// OpenAI Responses APIのStructured Outputs用スキーマ。
// strict:true のため required に全プロパティを列挙し、additionalProperties:false とする。
const VOICE_INTENT_SCHEMA = {
  type: 'object',
  properties: {
    intent: {
      type: 'string',
      enum: INTENTS,
      description: '発話の目的。',
    },
    title: {
      type: ['string', 'null'],
      description:
        '中心となる言葉。予定・やることの内容、買う品物、お薬の名前、荷物の品名、' +
        'ゴミの種類、人の名前、場所の名前。読み取れなければ null。',
    },
    date: {
      type: ['string', 'null'],
      description:
        'YYYY-MM-DD形式の絶対日付。「明日」「来週の火曜日」等の相対表現は基準日から計算すること。読み取れなければ null。',
    },
    time: {
      type: ['string', 'null'],
      description:
        'HH:MM形式（24時間表記）。「朝」は08:00、「昼」は12:00、「夕方」は18:00、「寝る前」は21:00として扱ってよい。読み取れなければ null。',
    },
    weekday: {
      type: ['integer', 'null'],
      description: '曜日（日曜=0, 月曜=1, …, 土曜=6）。曜日が明示された場合のみ。無ければ null。',
    },
    dosage: {
      type: ['string', 'null'],
      description: 'お薬の分量（例: "1錠"）。無ければ null。',
    },
    phone: {
      type: ['string', 'null'],
      description: '電話番号。無ければ null。',
    },
    memo: {
      type: ['string', 'null'],
      description: '住所・場所の補足など、上記に当てはまらない補足。無ければ null。',
    },
  },
  required: ['intent', 'title', 'date', 'time', 'weekday', 'dosage', 'phone', 'memo'],
  additionalProperties: false,
}

function buildSystemPrompt(todayJst: string, weekdayLabel: string): string {
  return [
    'あなたは高齢者向け音声アシスタント「ばーばAI」の意図解析器です。',
    'ご本人の発話（音声を文字起こししたテキスト）から、どの操作をしたいのかを判定し、必要な情報を抽出してください。',
    `今日は ${todayJst}（${weekdayLabel}曜日・日本時間）です。「明日」「来週の火曜日」等の相対表現はこれを基準に絶対日付(YYYY-MM-DD)へ変換してください。`,
    '【意図の一覧】',
    'create_event … カレンダーに載せる予定。例:「来週火曜日に立川病院」「明日10時に美容院」',
    'create_task … 完了を管理する行動（やること）。例:「電気代を払わないと」',
    'add_shopping … 買う物の登録。例:「牛乳買っといて」「醤油がなくなった」',
    'complete_task … やること・買い物が済んだ報告。例:「牛乳買ったよ」「病院の予約したよ」',
    'take_medication … 薬を飲んだ報告。例:「薬飲んだ」「朝の薬のんだよ」',
    'add_medication … これから毎日飲む薬の登録。例:「毎朝8時にこの血圧の薬を飲んでるの」',
    'add_delivery … 荷物が届く予定。例:「明日荷物が届く」',
    'set_garbage … ゴミ収集日の登録。例:「明日は燃えるゴミの日なの」「火曜日はプラスチック」',
    'add_contact … 電話番号の登録。例:「娘の電話番号は090-1234-5678」',
    'call_contact … 電話をかけたい。例:「娘に電話して」「山田さんに電話」',
    'add_location … よく行く場所の登録。例:「いつもの美容院は駅前の山田美容室」',
    'query_schedule … 予定の確認。例:「今日の予定は？」',
    'query_shopping … 買う物の確認。例:「買うものなんだっけ？」',
    'query_garbage … ゴミの日の確認。例:「今日のゴミは何？」「ゴミの日いつ？」',
    'query_medication … お薬の確認。例:「今日の薬は？」',
    'ambiguous … 予定(create_event)かやること(create_task)か判別できない場合のみ。',
    'unknown … 上記のどれにも当てはまらない、または内容が読み取れない場合。',
    '【注意】',
    '「〜を買っておいて」「〜がなくなった」は add_shopping、「〜を買った」は complete_task です。',
    '薬を「飲んだ」報告は take_medication、これから毎日飲む薬の登録は add_medication です。',
    'title には余計な語（「を買う」「の予定」など）を含めず、中心の言葉だけを入れてください。',
    '発話に含まれていない日付・時刻・電話番号は推測せず null にしてください。',
  ].join('\n')
}

/**
 * OpenAI Responses APIで意図解析を行う。
 * APIキー未設定・API失敗・レスポンス不正のいずれの場合も例外は投げず、'unknown'を返す。
 */
async function extractIntentWithOpenAI(transcript: string): Promise<ExtractedIntent> {
  const apiKey = Deno.env.get('OPENAI_API_KEY')
  if (!apiKey) {
    console.warn('[process-voice-input] OPENAI_API_KEYが未設定のため意図解析をスキップします')
    return UNKNOWN_EXTRACTION
  }
  const model = Deno.env.get('OPENAI_EXTRACT_MODEL') ?? 'gpt-4o-mini'
  const today = todayJstDateString()
  const [y, m, d] = today.split('-').map(Number)
  const weekdayLabel = WEEKDAY_KANJI[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]

  try {
    const res = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        input: [
          { role: 'system', content: buildSystemPrompt(today, weekdayLabel) },
          { role: 'user', content: transcript },
        ],
        text: {
          format: {
            type: 'json_schema',
            name: 'voice_intent',
            schema: VOICE_INTENT_SCHEMA,
            strict: true,
          },
        },
      }),
    })

    if (!res.ok) {
      console.error('[process-voice-input] OpenAI API error:', res.status, await res.text())
      return UNKNOWN_EXTRACTION
    }

    // Responses APIの出力は output[].content[].text に入る（output_textはSDK側の便宜プロパティ）。
    const json = await res.json()
    let rawText: string | null = typeof json?.output_text === 'string' ? json.output_text : null
    if (!rawText) {
      for (const item of json?.output ?? []) {
        for (const content of item?.content ?? []) {
          if (typeof content?.text === 'string') {
            rawText = content.text
            break
          }
        }
        if (rawText) break
      }
    }
    if (!rawText) {
      console.error('[process-voice-input] OpenAIレスポンスからテキストを取得できませんでした')
      return UNKNOWN_EXTRACTION
    }

    const parsed = JSON.parse(rawText)
    const intent: VoiceIntent = INTENTS.includes(parsed?.intent) ? parsed.intent : 'unknown'
    if (intent === 'unknown') return UNKNOWN_EXTRACTION

    const s = (value: unknown): string | null =>
      typeof value === 'string' && value.trim() !== '' ? value.trim() : null
    const weekday =
      typeof parsed?.weekday === 'number' && parsed.weekday >= 0 && parsed.weekday <= 6
        ? Math.trunc(parsed.weekday)
        : null

    return {
      intent,
      title: s(parsed?.title),
      date: s(parsed?.date),
      time: s(parsed?.time),
      weekday,
      dosage: s(parsed?.dosage),
      phone: s(parsed?.phone),
      memo: s(parsed?.memo),
    }
  } catch (error) {
    console.error('[process-voice-input] 意図解析に失敗しました:', error)
    return UNKNOWN_EXTRACTION
  }
}

// --- 日時ユーティリティ（JST基準） --------------------------------------

/** JSTの日付(YYYY-MM-DD)・時刻(HH:MM)をUTCのISO文字列へ変換する。 */
function jstToUtcIso(date: string, time: string | null): string | null {
  const dateMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date)
  if (!dateMatch) return null
  let hour = 0
  let minute = 0
  if (time !== null) {
    const timeMatch = /^(\d{1,2}):(\d{2})$/.exec(time)
    if (!timeMatch) return null
    hour = Number(timeMatch[1])
    minute = Number(timeMatch[2])
    if (hour > 23 || minute > 59) return null
  }
  const wall = new Date(
    Date.UTC(Number(dateMatch[1]), Number(dateMatch[2]) - 1, Number(dateMatch[3]), hour, minute),
  )
  if (Number.isNaN(wall.getTime())) return null
  return jstDateToUtcIso(wall)
}

/** JSTの「今日+offsetDays」の0:00と翌日0:00をUTCのISO文字列で返す。 */
function dayRangeUtcIso(offsetDays: number): { fromIso: string; toIso: string } {
  const [y, m, d] = todayJstDateString().split('-').map(Number)
  return {
    fromIso: jstDateToUtcIso(new Date(Date.UTC(y, m - 1, d + offsetDays))),
    toIso: jstDateToUtcIso(new Date(Date.UTC(y, m - 1, d + offsetDays + 1))),
  }
}

/** YYYY-MM-DD から JSTの曜日番号（日曜=0）を求める。 */
function weekdayOfDate(date: string): number | null {
  const matched = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date)
  if (!matched) return null
  return new Date(Date.UTC(Number(matched[1]), Number(matched[2]) - 1, Number(matched[3]))).getUTCDay()
}

/** YYYY-MM-DD を「8月14日（木）」にする。 */
function dateLabel(date: string): string {
  const matched = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date)
  if (!matched) return date
  const weekday = weekdayOfDate(date) ?? 0
  return `${Number(matched[2])}月${Number(matched[3])}日（${WEEKDAY_KANJI[weekday]}）`
}

/** UTCのISO文字列をJSTの「9:30」にする。0:00は時刻未定とみなす。 */
function timeLabel(utcIso: string): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Tokyo',
    hour: 'numeric',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(new Date(utcIso))
  const pick = (type: string) => parts.find((p) => p.type === type)?.value ?? ''
  const hour = Number(pick('hour')) % 24
  const minute = pick('minute')
  if (Number.isNaN(hour) || minute === '') return ''
  if (hour === 0 && minute === '00') return ''
  return `${hour}:${minute}`
}

/** 「今日」「明日」またはYYYY-MM-DD表記の日付ラベル。 */
function relativeDateLabel(date: string): string {
  if (date === todayJstDateString()) return '今日'
  const [y, m, d] = todayJstDateString().split('-').map(Number)
  const tomorrow = new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10)
  if (date === tomorrow) return '明日'
  return dateLabel(date)
}

// --- 照合ユーティリティ --------------------------------------------------

/** 表記ゆれを吸収した簡易照合（部分一致）。 */
function looseMatch(a: string, b: string): boolean {
  const normalize = (text: string) => text.replace(/[\s　・、。]/g, '').toLowerCase()
  const x = normalize(a)
  const y = normalize(b)
  if (x === '' || y === '') return false
  return x.includes(y) || y.includes(x)
}

// --- 応答の組み立て ------------------------------------------------------

type Mode = 'confirm' | 'question' | 'answer'

interface Outcome {
  mode: Mode
  /** 確認・質問・回答の本文。 */
  text: string
  /** execute-confirmed-action へ渡す内容。 */
  payload: Record<string, unknown>
  /** 聞き返し済みの項目名（同じことを二度聞かないために使う）。 */
  asked?: string[]
}

function confirmOutcome(text: string, payload: Record<string, unknown>): Outcome {
  return { mode: 'confirm', text, payload }
}

function answerOutcome(text: string, payload: Record<string, unknown> = {}): Outcome {
  return { mode: 'answer', text, payload }
}

function questionOutcome(text: string, asked: string[], payload: Record<string, unknown>): Outcome {
  return { mode: 'question', text, payload, asked }
}

Deno.serve(async (req) => {
  const preflight = handlePreflight(req)
  if (preflight) return preflight

  if (req.method !== 'POST') {
    return jsonError(ErrorCode.METHOD_NOT_ALLOWED, 'POSTのみ許可されています', 405)
  }

  // 1. リクエストボディの取得・バリデーション
  let body: ProcessVoiceInputRequest
  try {
    body = await req.json()
  } catch {
    return jsonError(ErrorCode.INVALID_JSON, 'リクエストボディがJSONとして不正です', 400)
  }
  if (!body.transcript || typeof body.transcript !== 'string' || body.transcript.trim() === '') {
    return jsonError(ErrorCode.VALIDATION_ERROR, 'transcriptは必須です', 400)
  }
  const alreadyAsked = Array.isArray(body.asked)
    ? body.asked.filter((item): item is string => typeof item === 'string')
    : []

  const supabase = createServiceRoleClient()

  // 2. 認証確認（デバイスセッション検証。JWTは使用しない）
  const deviceAuth = await getDeviceAuthContext(req, supabase)
  if (!deviceAuth) {
    return jsonError(ErrorCode.DEVICE_AUTH_INVALID, 'デバイス認証に失敗しました', 401)
  }
  const profileId = deviceAuth.profileId

  // 3. voice_requests を作成（受付ログとしての役割も兼ねる。初期状態は'received'）
  const { data: voiceRequest, error: insertError } = await supabase
    .from('voice_requests')
    .insert({
      profile_id: profileId,
      source: 'principal_voice',
      created_by_device_id: deviceAuth.deviceId,
      created_by_auth_user_id: deviceAuth.registeredByAuthUserId ?? null,
      raw_transcript: body.transcript,
      status: 'received',
      created_at: nowUtcIso(),
    })
    .select('id')
    .single()

  if (insertError || !voiceRequest) {
    return jsonError(ErrorCode.INTERNAL_ERROR, '音声リクエストの作成に失敗しました', 500, insertError?.message)
  }

  // 4. 意図解析
  const extracted = await extractIntentWithOpenAI(body.transcript)
  const today = todayJstDateString()

  /** profiles.memo に格納したゴミの日設定を読む。 */
  async function loadGarbage(): Promise<Record<string, string>> {
    const { data } = await supabase.from('profiles').select('memo').eq('id', profileId).maybeSingle()
    try {
      const parsed = JSON.parse(typeof data?.memo === 'string' ? data.memo : '{}')
      const garbage = parsed?.garbage
      if (!garbage || typeof garbage !== 'object') return {}
      const result: Record<string, string> = {}
      for (const key of ['0', '1', '2', '3', '4', '5', '6']) {
        const value = (garbage as Record<string, unknown>)[key]
        if (typeof value === 'string' && value.trim() !== '') result[key] = value.trim()
      }
      return result
    } catch {
      return {}
    }
  }

  // 5. 意図ごとに「確認」「聞き返し」「その場の回答」を組み立てる
  async function buildOutcome(): Promise<Outcome> {
    const { intent, title, date, time } = extracted

    switch (intent) {
      case 'unknown':
        return answerOutcome(UNKNOWN_PROMPT)

      case 'ambiguous':
        if (!title) return answerOutcome(UNKNOWN_PROMPT)
        return { mode: 'confirm', text: AMBIGUOUS_PROMPT, payload: { title, date, time } }

      case 'create_event': {
        if (!title) return answerOutcome(UNKNOWN_PROMPT)
        if (!date && !alreadyAsked.includes('date')) {
          return questionOutcome(`${title} は、いつの予定でしょうか。日付を教えてください。`, ['date'], {
            title,
            time,
          })
        }
        if (date && !time && !alreadyAsked.includes('time')) {
          return questionOutcome(
            `${title} は、何時からでしょうか。決まっていなければ「わからない」とお答えください。`,
            ['date', 'time'],
            { title, date },
          )
        }
        const when = [date ? relativeDateLabel(date) : '今日', time ?? ''].filter((p) => p !== '').join(' ')
        return confirmOutcome(`${when} の ${title} を予定に登録します。よろしいですか？`, {
          title,
          date: date ?? today,
          time,
        })
      }

      case 'create_task': {
        if (!title) return answerOutcome(UNKNOWN_PROMPT)
        const when = [date ? relativeDateLabel(date) : '', time ?? ''].filter((p) => p !== '').join(' ')
        return confirmOutcome(
          when
            ? `${when} までの ${title} をやることに登録します。よろしいですか？`
            : `${title} をやることに登録します。よろしいですか？`,
          { title, date, time },
        )
      }

      case 'add_shopping': {
        if (!title) return answerOutcome(UNKNOWN_PROMPT)
        return confirmOutcome(`買い物メモに ${title} を追加します。よろしいですか？`, { title })
      }

      case 'complete_task': {
        if (!title) return answerOutcome(UNKNOWN_PROMPT)
        const { data } = await supabase
          .from('tasks')
          .select('id, title, category')
          .eq('profile_id', profileId)
          .is('deleted_at', null)
          .eq('status', 'open')
          .order('created_at', { ascending: false })
        const matched = (data ?? []).find((row) => looseMatch(row.title as string, title))
        if (!matched) {
          return answerOutcome(
            `${title} は、やること・買い物メモのどちらにも見つかりませんでした。`,
          )
        }
        const isShopping = matched.category === 'shopping'
        return confirmOutcome(
          isShopping
            ? `買い物メモの ${matched.title} を「買いました」にします。よろしいですか？`
            : `やることの ${matched.title} を「済みました」にします。よろしいですか？`,
          { targetId: matched.id, title: matched.title },
        )
      }

      case 'take_medication': {
        // 今日ぶんの未服用の予定から、指定時間帯・薬名に合うものを選ぶ。
        const range = dayRangeUtcIso(0)
        const { data } = await supabase
          .from('medication_logs')
          .select('id, medication_name, dosage, scheduled_at')
          .eq('profile_id', profileId)
          .is('deleted_at', null)
          .eq('status', 'scheduled')
          .gte('scheduled_at', range.fromIso)
          .lt('scheduled_at', range.toIso)
          .order('scheduled_at', { ascending: true })

        let candidates = data ?? []
        if (title) {
          const byName = candidates.filter((row) => looseMatch(row.medication_name as string, title))
          if (byName.length > 0) candidates = byName
        }
        if (time) {
          const target = jstToUtcIso(today, time)
          if (target) {
            const targetMs = new Date(target).getTime()
            // 指定時刻にいちばん近いものを選ぶ。
            candidates = [...candidates].sort(
              (a, b) =>
                Math.abs(new Date(a.scheduled_at as string).getTime() - targetMs) -
                Math.abs(new Date(b.scheduled_at as string).getTime() - targetMs),
            )
          }
        }
        if (candidates.length === 0) {
          return answerOutcome(
            '今日の飲むお薬の予定が見つかりませんでした。「毎朝8時に○○を飲んでいます」と話しかけると登録できます。',
          )
        }
        const target = candidates[0]
        const label = [timeLabel(target.scheduled_at as string), target.medication_name as string]
          .filter((part) => part !== '')
          .join(' の ')
        return confirmOutcome(`${label} を「飲みました」にします。よろしいですか？`, {
          targetId: target.id,
          title: target.medication_name,
        })
      }

      case 'add_medication': {
        if (!title && !alreadyAsked.includes('medicationName')) {
          return questionOutcome('お薬の名前を教えてください。', ['medicationName'], { time })
        }
        if (!title) return answerOutcome(UNKNOWN_PROMPT)
        if (!time && !alreadyAsked.includes('medicationTime')) {
          return questionOutcome(`${title} は、何時に飲むお薬でしょうか。`, ['medicationTime'], {
            title,
          })
        }
        if (!time) return answerOutcome(UNKNOWN_PROMPT)
        return confirmOutcome(
          `毎日 ${time} に ${title} を飲むお薬として、${MEDICATION_DAYS}日ぶん登録します。よろしいですか？`,
          { title, time, dosage: extracted.dosage, days: MEDICATION_DAYS },
        )
      }

      case 'add_delivery': {
        const itemName = title ?? '荷物'
        const when = date ? relativeDateLabel(date) : null
        if (!date && !alreadyAsked.includes('deliveryDate')) {
          return questionOutcome(`${itemName} は、いつ届く予定でしょうか。`, ['deliveryDate'], {
            title: itemName,
          })
        }
        return confirmOutcome(
          when
            ? `${when} ${itemName} が届く予定として登録します。よろしいですか？`
            : `${itemName} が届く予定として登録します。よろしいですか？`,
          { title: itemName, date, time },
        )
      }

      case 'set_garbage': {
        if (!title) return answerOutcome('どの種類のゴミか聞き取れませんでした。もう一度お話しください。')
        const weekday = extracted.weekday ?? (date ? weekdayOfDate(date) : null)
        if (weekday === null && !alreadyAsked.includes('garbageWeekday')) {
          return questionOutcome(`${title} は、何曜日でしょうか。`, ['garbageWeekday'], { title })
        }
        if (weekday === null) return answerOutcome(UNKNOWN_PROMPT)
        return confirmOutcome(
          `毎週 ${WEEKDAY_KANJI[weekday]}曜日 を ${title} の日として登録します。よろしいですか？`,
          { weekday, title },
        )
      }

      case 'add_contact': {
        if (!title && !alreadyAsked.includes('contactName')) {
          return questionOutcome('どなたの電話番号でしょうか。お名前を教えてください。', ['contactName'], {
            phone: extracted.phone,
          })
        }
        if (!title) return answerOutcome(UNKNOWN_PROMPT)
        if (!extracted.phone && !alreadyAsked.includes('contactPhone')) {
          return questionOutcome(`${title} の電話番号を教えてください。`, ['contactPhone'], { title })
        }
        if (!extracted.phone) return answerOutcome(UNKNOWN_PROMPT)
        return confirmOutcome(
          `${title} の電話番号を ${extracted.phone} として登録します。よろしいですか？`,
          { title, phone: extracted.phone },
        )
      }

      case 'call_contact': {
        if (!title) return answerOutcome('どなたにお電話しますか。もう一度お話しください。')
        const { data } = await supabase
          .from('contacts')
          .select('id, name, relationship, phone_number')
          .eq('profile_id', profileId)
          .is('deleted_at', null)
        const matched = (data ?? []).find(
          (row) =>
            looseMatch(row.name as string, title) ||
            (row.relationship ? looseMatch(row.relationship as string, title) : false),
        )
        if (!matched?.phone_number) {
          return answerOutcome(
            `${title} の電話番号はまだ登録されていません。「${title}の電話番号は◯◯」と話しかけると登録できます。`,
          )
        }
        return answerOutcome(`${matched.name} に電話をかけます。`, {
          phoneNumber: matched.phone_number,
          contactName: matched.name,
        })
      }

      case 'add_location': {
        if (!title) return answerOutcome(UNKNOWN_PROMPT)
        return confirmOutcome(`よく行く場所として ${title} を覚えておきます。よろしいですか？`, {
          title,
          memo: extracted.memo,
        })
      }

      case 'query_schedule': {
        const offset = date === null ? 0 : Math.round((Date.parse(date) - Date.parse(today)) / 86_400_000)
        const range = dayRangeUtcIso(Number.isFinite(offset) ? offset : 0)
        const { data } = await supabase
          .from('events')
          .select('title, starts_at')
          .eq('profile_id', profileId)
          .is('deleted_at', null)
          .neq('status', 'cancelled')
          .gte('starts_at', range.fromIso)
          .lt('starts_at', range.toIso)
          .order('starts_at', { ascending: true })
        const label = date ? relativeDateLabel(date) : '今日'
        if ((data ?? []).length === 0) return answerOutcome(`${label}の予定はありません。`)
        const lines = (data ?? []).map((row) => {
          const at = timeLabel(row.starts_at as string)
          return at ? `${at} ${row.title as string}` : (row.title as string)
        })
        return answerOutcome(`${label}の予定は ${lines.length}件です。\n${lines.join('\n')}`)
      }

      case 'query_shopping': {
        const { data } = await supabase
          .from('tasks')
          .select('title')
          .eq('profile_id', profileId)
          .is('deleted_at', null)
          .eq('status', 'open')
          .eq('category', 'shopping')
          .order('created_at', { ascending: true })
        if ((data ?? []).length === 0) return answerOutcome('買うものはありません。')
        const names = (data ?? []).map((row) => row.title as string)
        return answerOutcome(`買うものは ${names.length}つです。\n${names.join('、')}`)
      }

      case 'query_garbage': {
        const garbage = await loadGarbage()
        if (Object.keys(garbage).length === 0) {
          return answerOutcome(
            'ゴミの日はまだ登録されていません。「火曜日は燃えるゴミの日」と話しかけると登録できます。',
          )
        }
        const baseOffset = date
          ? Math.round((Date.parse(date) - Date.parse(today)) / 86_400_000)
          : 0
        const offset = Number.isFinite(baseOffset) ? baseOffset : 0
        const [y, m, d] = today.split('-').map(Number)
        const weekdayAt = (add: number) => new Date(Date.UTC(y, m - 1, d + add)).getUTCDay()
        const askedLabel = offset === 0 ? '今日' : offset === 1 ? '明日' : dateLabel(date ?? today)
        const onDay = garbage[String(weekdayAt(offset))] ?? null
        if (onDay) return answerOutcome(`${askedLabel}は ${onDay} の日です。`)
        // 収集が無い日は、次の収集日を案内する。
        for (let add = offset + 1; add <= offset + 7; add++) {
          const kind = garbage[String(weekdayAt(add))]
          if (kind) {
            const nextDate = new Date(Date.UTC(y, m - 1, d + add)).toISOString().slice(0, 10)
            return answerOutcome(
              `${askedLabel}はゴミの収集はありません。次は ${relativeDateLabel(nextDate)} の ${kind} です。`,
            )
          }
        }
        return answerOutcome(`${askedLabel}はゴミの収集はありません。`)
      }

      case 'query_medication': {
        const range = dayRangeUtcIso(0)
        const { data } = await supabase
          .from('medication_logs')
          .select('medication_name, dosage, scheduled_at, status')
          .eq('profile_id', profileId)
          .is('deleted_at', null)
          .gte('scheduled_at', range.fromIso)
          .lt('scheduled_at', range.toIso)
          .order('scheduled_at', { ascending: true })
        if ((data ?? []).length === 0) return answerOutcome('今日のお薬の予定はありません。')
        const lines = (data ?? []).map((row) => {
          const at = timeLabel(row.scheduled_at as string)
          const done = row.status === 'taken' ? '（飲みました）' : ''
          return `${at} ${row.medication_name as string}${done}`
        })
        return answerOutcome(`今日のお薬は ${lines.length}回です。\n${lines.join('\n')}`)
      }
    }

    return answerOutcome(UNKNOWN_PROMPT)
  }

  const outcome = await buildOutcome()

  const interpretedPayload = {
    payload: outcome.payload,
    confirmationPrompt: outcome.text,
    mode: outcome.mode,
    // 質問モードのとき、次の発話と一緒に送り返してもらう（同じことを二度聞かないため）。
    asked: [...new Set([...alreadyAsked, ...(outcome.asked ?? [])])],
  }

  // 6. 解析結果をvoice_requestsに反映。
  //    その場で答えるだけ（answer）・聞き返し（question）は書き込みを伴わないため、
  //    ここで最終状態にしておく（確認待ちのまま残さない）。
  await supabase
    .from('voice_requests')
    .update({
      interpreted_intent: extracted.intent,
      interpreted_payload: interpretedPayload,
      ...(outcome.mode === 'confirm' ? {} : { status: 'executed' }),
    })
    .eq('id', voiceRequest.id)

  return jsonSuccess(
    {
      voiceRequestId: voiceRequest.id,
      interpretedIntent: extracted.intent,
      interpretedPayload,
    },
    201,
  )
})
