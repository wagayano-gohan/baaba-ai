// process-voice-input: 音声認識結果から voice_requests を作成し、確認待ちアクションを生成する。
// 呼び出し元: 本人(principal)のデバイス。メール・パスワード・PINを使わないため、
// register-deviceで払い出された生トークンによるデバイス認証(x-device-token)を使用する。
//
// 正式確定仕様:
//   - source は 'principal_voice' | 'family' | 'system' のみ許可。本人デバイス起点のため 'principal_voice'。
//   - source='principal_voice'の場合、created_by_device_id のみ必須。created_by_auth_user_id は
//     null許容（本人=principalはSupabase Authアカウントを持たない設計と一貫させるため）。
//     参考情報として、デバイス登録者(registered_devices.registered_by_auth_user_id)が
//     取得できればcreated_by_auth_user_idに設定するが、必須ではない。
//   - raw_transcript（raw_textではない）。
//   - status は 'received' | 'confirmed' | 'executed' | 'rejected' | 'failed'。
//     'pending_confirmation' 相当の状態は 'received'（初期値）で表現する。
//   - interpreted_intent / interpreted_payload（parsed_actionは存在しない）。
//   - handled_at カラムは存在しない。
//
// 必要なSupabase Secrets（意図解析ステップで使用）:
//   - OPENAI_API_KEY       … OpenAI APIキー。未設定でも関数は動作するが、意図は常に'unknown'になる。
//   - OPENAI_EXTRACT_MODEL … 意図解析に使うモデル名。未設定時は 'gpt-4o-mini'。
//   設定例: supabase secrets set OPENAI_API_KEY=sk-... OPENAI_EXTRACT_MODEL=gpt-4o-mini

import { handlePreflight } from '../_shared/cors.ts'
import { jsonError, jsonSuccess, ErrorCode } from '../_shared/errors.ts'
import { getDeviceAuthContext } from '../_shared/auth.ts'
import { createServiceRoleClient } from '../_shared/supabaseClient.ts'
import { nowUtcIso, todayJstDateString } from '../_shared/datetime.ts'

interface ProcessVoiceInputRequest {
  transcript: string
}

// Phase2で扱う意図はこの4種類のみ（execute-confirmed-actionのTODOに記載された
// create_task / create_event に準拠）。これ以外の意図は追加しない。
//   - ambiguous … 予定かやることか判別できない場合。ユーザーに聞き返す。
//   - unknown   … そもそも意図が読み取れない場合。
type VoiceIntent = 'create_event' | 'create_task' | 'ambiguous' | 'unknown'

interface ExtractedIntent {
  intent: VoiceIntent
  title: string | null
  date: string | null
  time: string | null
}

const UNKNOWN_EXTRACTION: ExtractedIntent = { intent: 'unknown', title: null, date: null, time: null }
const UNKNOWN_PROMPT = '内容を確認できませんでした。もう一度お話しください。'
const AMBIGUOUS_PROMPT = '予定として登録しますか？ やることとして登録しますか？'

// OpenAI Responses APIのStructured Outputs用スキーマ。
// strict:true のため required に全プロパティを列挙し、additionalProperties:false とする。
const VOICE_INTENT_SCHEMA = {
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

function buildSystemPrompt(todayJst: string): string {
  return [
    'あなたは高齢者向け音声アシスタント「ばーばAI」の意図解析器です。',
    'ユーザーの発話（音声を文字起こししたテキスト）から、「予定(create_event)」か「やること(create_task)」かを判定し、',
    '内容（タイトル）・日付・時刻を抽出してください。',
    `今日の日付は ${todayJst}（日本時間）です。「明日」「あさって」「来週の月曜日」等の相対的な表現は、これを基準に絶対日付(YYYY-MM-DD)へ変換してください。`,
    '【判定基準】日時が含まれているかどうかでは判定しません。「カレンダー上の予定」なのか「完了を管理する行動」なのかで判定してください。',
    'create_event（予定）… カレンダーに載せる予定。例: 病院、歯医者、会食、通院、外出予定、薬の予定、ゴミの日、記念日、指定時刻のリマインダー。',
    'create_task（やること）… 完了チェックを目的とする行動。例: やること、買い物メモ、忘れ物チェック、期限付きToDo。',
    'やることは期限(due_at)を持つ場合があります。期限や日時が伴っていても、行動の完了を管理するものは create_task です。',
    '予定なのかやることなのか判別できない場合は、どちらかに決めつけず intent を "ambiguous" にしてください。タイトル・日付・時刻は読み取れた範囲で出力してください。',
    'そもそも予定・やることの登録意図でない場合、または内容が読み取れない場合は intent を "unknown" にし、他のフィールドはすべて null にしてください。',
    '発話に含まれていない日付・時刻は推測せず null にしてください。時刻は24時間表記のHH:MM形式で出力してください。',
  ].join('\n')
}

/**
 * OpenAI Responses APIで意図解析を行う。
 * APIキー未設定・API失敗・レスポンス不正のいずれの場合も例外は投げず、'unknown'を返す
 * （音声リクエストの記録とクライアントへの応答は必ず継続させるため）。
 */
async function extractIntentWithOpenAI(transcript: string): Promise<ExtractedIntent> {
  const apiKey = Deno.env.get('OPENAI_API_KEY')
  if (!apiKey) {
    console.warn('[process-voice-input] OPENAI_API_KEYが未設定のため意図解析をスキップします')
    return UNKNOWN_EXTRACTION
  }
  const model = Deno.env.get('OPENAI_EXTRACT_MODEL') ?? 'gpt-4o-mini'

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
          { role: 'system', content: buildSystemPrompt(todayJstDateString()) },
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
    const intent: VoiceIntent =
      parsed?.intent === 'create_event' || parsed?.intent === 'create_task' || parsed?.intent === 'ambiguous'
        ? parsed.intent
        : 'unknown'
    if (intent === 'unknown') return UNKNOWN_EXTRACTION

    // タイトルが取れない場合は確認しようがないため、ambiguousも含めて'unknown'へ倒す。
    const title = typeof parsed?.title === 'string' && parsed.title.trim() !== '' ? parsed.title : null
    if (!title) return UNKNOWN_EXTRACTION

    return {
      intent,
      title,
      date: typeof parsed?.date === 'string' && parsed.date.trim() !== '' ? parsed.date : null,
      time: typeof parsed?.time === 'string' && parsed.time.trim() !== '' ? parsed.time : null,
    }
  } catch (error) {
    console.error('[process-voice-input] 意図解析に失敗しました:', error)
    return UNKNOWN_EXTRACTION
  }
}

/** ユーザーへ提示する確認文言を組み立てる。 */
function buildConfirmationPrompt(extracted: ExtractedIntent): string {
  if (extracted.intent === 'unknown' || !extracted.title) return UNKNOWN_PROMPT
  // 予定かやることか判別できない場合は、勝手に保存せずユーザーへ聞き返す。
  if (extracted.intent === 'ambiguous') return AMBIGUOUS_PROMPT
  const kind = extracted.intent === 'create_event' ? '予定' : 'やること'
  const when = [extracted.date ?? '', extracted.time ?? ''].filter((part) => part !== '').join(' ')
  return when
    ? `${when} の ${extracted.title} を ${kind} に登録します。よろしいですか？`
    : `${extracted.title} を ${kind} に登録します。よろしいですか？`
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

  const supabase = createServiceRoleClient()

  // 2. 認証確認（デバイスセッション検証。JWTは使用しない）
  const deviceAuth = await getDeviceAuthContext(req, supabase)
  if (!deviceAuth) {
    return jsonError(ErrorCode.DEVICE_AUTH_INVALID, 'デバイス認証に失敗しました', 401)
  }

  // 3. voice_requests を作成（受付ログとしての役割も兼ねる。初期状態は'received'）
  // source='principal_voice'はcreated_by_device_idのみ必須。created_by_auth_user_idはnull許容のため、
  // デバイス登録者(owner_admin)が特定できない場合でも処理を継続する（付加情報として設定できれば設定する）。
  const { data: voiceRequest, error: insertError } = await supabase
    .from('voice_requests')
    .insert({
      profile_id: deviceAuth.profileId,
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

  // 4. 発話内容の意図解析・アクション候補生成
  // OpenAI Responses APIのStructured Outputsで create_event / create_task / ambiguous / unknown を判定する。
  // APIキー未設定・API失敗時も例外にせず'unknown'にフォールバックし、以降のステップを継続する。
  // ambiguousの場合もタイトル・日付・時刻はpayloadへ入れ、確認文言で予定/やることを聞き返す。
  const extracted = await extractIntentWithOpenAI(body.transcript)
  const interpretedIntent = extracted.intent
  const interpretedPayload = {
    payload:
      extracted.intent === 'unknown'
        ? {}
        : { title: extracted.title, date: extracted.date, time: extracted.time },
    confirmationPrompt: buildConfirmationPrompt(extracted),
  }

  // 5. 解析結果をvoice_requestsに反映（ステータスは'received'のまま。確認はexecute-confirmed-actionで行う）
  await supabase
    .from('voice_requests')
    .update({ interpreted_intent: interpretedIntent, interpreted_payload: interpretedPayload })
    .eq('id', voiceRequest.id)

  // 6. 確認待ちアクションをクライアントへ返却（音声/画面での最終確認後、execute-confirmed-actionを呼ぶ）
  return jsonSuccess(
    {
      voiceRequestId: voiceRequest.id,
      interpretedIntent,
      interpretedPayload,
    },
    201,
  )
})
