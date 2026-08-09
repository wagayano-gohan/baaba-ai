// get-today-events: ホーム画面「今日の予定」を取得する。
//
// events の SELECT RLS は `to authenticated` のため、Supabase Authアカウントを持たない
// 本人(principal)端末（デバイストークンのみ）からはクライアント直接SELECTで0件になる。
// 本人がホーム画面で自分の予定を見られないのは利用上の致命的な支障になるため、
// service roleで読み出してprofile単位に絞って返す専用の読み取りFunctionを設ける。
//
// 呼び出し元は2種類（どちらかの認証が通ればよい）:
//   1. 本人端末 … x-device-token（対象profileはトークンから決まる）
//   2. 家族アカウント … Authorization: Bearer <JWT>（profile_membershipsで所属を確認する）
//
// リクエスト: { profileId?: string }（家族アカウントの場合は必須）
// レスポンス: jsonSuccess({ events: [{ id, title, startsAt, category }] })

import { handlePreflight } from '../_shared/cors.ts'
import { jsonError, jsonSuccess, ErrorCode } from '../_shared/errors.ts'
import { getAuthContext, getDeviceAuthContext, requireProfileMembership } from '../_shared/auth.ts'
import { createServiceRoleClient } from '../_shared/supabaseClient.ts'
import { todayJstDateString, jstDateToUtcIso } from '../_shared/datetime.ts'

/** JSTの今日 0:00 と 翌日 0:00 を、UTCのISO文字列で返す。 */
function todayRangeUtcIso(): { fromIso: string; toIso: string } {
  const today = todayJstDateString() // YYYY-MM-DD（JST基準）
  const [year, month, day] = today.split('-').map(Number)
  const startJst = new Date(Date.UTC(year, month - 1, day, 0, 0, 0))
  const endJst = new Date(Date.UTC(year, month - 1, day + 1, 0, 0, 0))
  return { fromIso: jstDateToUtcIso(startJst), toIso: jstDateToUtcIso(endJst) }
}

Deno.serve(async (req) => {
  const preflight = handlePreflight(req)
  if (preflight) return preflight

  if (req.method !== 'POST') {
    return jsonError(ErrorCode.METHOD_NOT_ALLOWED, 'POSTのみ許可されています', 405)
  }

  let body: { profileId?: unknown } = {}
  try {
    body = await req.json()
  } catch {
    // ボディ無しでも本人端末なら成立するため、ここでは失敗させない。
  }

  const supabase = createServiceRoleClient()

  // 1. 対象profileの決定と権限確認
  let profileId: string | null = null

  const deviceAuth = req.headers.get('x-device-token')
    ? await getDeviceAuthContext(req, supabase)
    : null

  if (deviceAuth) {
    // 本人端末はトークンに紐づくprofileのみ参照できる（他profileの指定は無視する）。
    profileId = deviceAuth.profileId
  } else {
    const authContext = await getAuthContext(req)
    if (!authContext) {
      return jsonError(ErrorCode.UNAUTHENTICATED, '認証情報が無効です', 401)
    }
    if (typeof body.profileId !== 'string' || body.profileId === '') {
      return jsonError(ErrorCode.VALIDATION_ERROR, 'profileIdは必須です', 400)
    }
    const membership = await requireProfileMembership(supabase, authContext.authUserId, body.profileId)
    if (!membership) {
      return jsonError(ErrorCode.PROFILE_ACCESS_DENIED, 'このプロフィールを参照する権限がありません', 403)
    }
    profileId = body.profileId
  }

  // 2. JSTの今日ぶんを取得
  const { fromIso, toIso } = todayRangeUtcIso()
  const { data, error } = await supabase
    .from('events')
    .select('id, title, starts_at, category')
    .eq('profile_id', profileId)
    .is('deleted_at', null)
    .neq('status', 'cancelled')
    .gte('starts_at', fromIso)
    .lt('starts_at', toIso)
    .order('starts_at', { ascending: true })

  if (error) {
    return jsonError(ErrorCode.INTERNAL_ERROR, '予定を取得できませんでした', 500, error.message)
  }

  const events = (data ?? []).map((row) => ({
    id: row.id as string,
    title: row.title as string,
    startsAt: row.starts_at as string,
    category: row.category as string,
  }))

  return jsonSuccess({ events })
})
