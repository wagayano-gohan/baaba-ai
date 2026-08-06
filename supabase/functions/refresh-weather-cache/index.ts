// refresh-weather-cache: weather_cache更新、weather_refresh_attempts記録・レート制限判定。
// 呼び出し元: owner_admin / viewer。JWT必須。
//
// 判定ロジック（force_refresh=trueの場合のみ適用。実装は下記RPC関数側に集約）:
//   条件1 = 同一profile_idで直近1時間の force_refresh=true かつ result in (allowed, api_success, api_failed) が3件未満
//   条件2 = 同一auth_user_idで直近5分の同条件が0件
//   両方満たせば許可。
// 記録順序:
//   要求 → JWT/権限確認 → 集計 → 超過ならresult=rate_limited記録して WEATHER_RATE_LIMITED を返却
//        → 許可ならresult=allowed記録 → Open-Meteo実行 → 成功でapi_success、失敗でapi_failedに更新
//
// 実マイグレーション準拠:
//   - チェック+記録の原子性を保証するため、独自にCOUNTクエリ2本＋INSERTを組み立てるのではなく、
//     service_role専用のRPC `check_and_record_weather_refresh_attempt`（pg_advisory_xact_lockで
//     profile_id単位にロックしてチェックとINSERTを原子的に行う）と、結果更新用の
//     `update_weather_refresh_attempt_result` を呼び出す。
//   - weather_cache には payload カラムは存在せず、weather_summary/temperature_max/temperature_min/
//     precipitation_probability/raw_response に分解して保存する。

import { handlePreflight } from '../_shared/cors.ts'
import { jsonError, jsonSuccess, ErrorCode } from '../_shared/errors.ts'
import { getAuthContext, requireProfileMembership } from '../_shared/auth.ts'
import { createServiceRoleClient } from '../_shared/supabaseClient.ts'
import { todayJstDateString } from '../_shared/datetime.ts'

interface RefreshWeatherCacheRequest {
  profileId: string
  latitude: number
  longitude: number
  forceRefresh: boolean
}

interface OpenMeteoDaily {
  weathercode?: number[]
  temperature_2m_max?: number[]
  temperature_2m_min?: number[]
  precipitation_probability_max?: number[]
}

function roundTo3Decimals(value: number): number {
  return Math.round(value * 1000) / 1000
}

// TODO: 実際の天気アイコン/文言セットに合わせてWMO weather codeの日本語要約表を整備する
function describeWeatherCode(code: number | undefined): string | null {
  if (code === undefined) return null
  return `weathercode:${code}` // プレースホルダー
}

Deno.serve(async (req) => {
  const preflight = handlePreflight(req)
  if (preflight) return preflight

  if (req.method !== 'POST') {
    return jsonError(ErrorCode.METHOD_NOT_ALLOWED, 'POSTのみ許可されています', 405)
  }

  // 1. リクエストボディの取得・バリデーション
  let body: RefreshWeatherCacheRequest
  try {
    body = await req.json()
  } catch {
    return jsonError(ErrorCode.INVALID_JSON, 'リクエストボディがJSONとして不正です', 400)
  }
  if (!body.profileId || typeof body.profileId !== 'string') {
    return jsonError(ErrorCode.VALIDATION_ERROR, 'profileIdは必須です', 400)
  }
  if (typeof body.latitude !== 'number' || typeof body.longitude !== 'number') {
    return jsonError(ErrorCode.VALIDATION_ERROR, 'latitude/longitudeは数値である必要があります', 400)
  }
  if (typeof body.forceRefresh !== 'boolean') {
    return jsonError(ErrorCode.VALIDATION_ERROR, 'forceRefreshは必須です', 400)
  }

  // 2. 認証確認（JWT検証）
  const authContext = await getAuthContext(req)
  if (!authContext) {
    return jsonError(ErrorCode.UNAUTHENTICATED, '認証情報が無効です', 401)
  }

  const supabase = createServiceRoleClient()

  // 3. profile_memberships確認（閲覧操作の一環のためowner_admin/viewer両方許可）
  const membership = await requireProfileMembership(supabase, authContext.authUserId, body.profileId, [
    'owner_admin',
    'viewer',
  ])
  if (!membership) {
    return jsonError(ErrorCode.PROFILE_ACCESS_DENIED, 'この操作を行う権限がありません', 403)
  }

  const latitude = roundTo3Decimals(body.latitude)
  const longitude = roundTo3Decimals(body.longitude)
  const forecastDate = todayJstDateString()

  // 4. forceRefresh=false の場合は通常のキャッシュ参照経路
  // （RPCのコメント通り、force_refresh=falseはレート制限集計対象外のためRPCを呼ばない）
  if (!body.forceRefresh) {
    // TODO: 必要に応じてキャッシュが無い/古い場合の非強制フェッチロジックを実装する
    const { data: cache } = await supabase
      .from('weather_cache')
      .select('*')
      .eq('profile_id', body.profileId)
      .eq('forecast_date', forecastDate)
      .maybeSingle()

    return jsonSuccess({ cache: cache ?? null, refreshed: false })
  }

  // ここから force_refresh=true の場合: レート制限チェック＋記録を原子的に行うRPCを呼び出す
  // 5. check_and_record_weather_refresh_attempt(profile_id, auth_user_id, force_refresh)
  const { data: rpcRows, error: rpcError } = await supabase.rpc('check_and_record_weather_refresh_attempt', {
    p_profile_id: body.profileId,
    p_auth_user_id: authContext.authUserId,
    p_force_refresh: true,
  })

  if (rpcError || !rpcRows || rpcRows.length === 0) {
    return jsonError(ErrorCode.INTERNAL_ERROR, 'レート制限判定に失敗しました', 500, rpcError?.message)
  }

  const { allowed, attempt_id: attemptId } = rpcRows[0] as { allowed: boolean; attempt_id: string }

  // 6. 制限超過の場合: RPC側で既にresult=rate_limitedが記録済みのためエラー返却のみ行う
  if (!allowed) {
    return jsonError(ErrorCode.WEATHER_RATE_LIMITED, '天気情報の更新回数が上限に達しました', 429)
  }

  // 7. 許可: RPC側で既にresult=allowedが記録済み。ここからOpen-Meteoを呼び出す。
  try {
    const apiUrl =
      `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}` +
      `&daily=weathercode,temperature_2m_max,temperature_2m_min,precipitation_probability_max` +
      `&timezone=Asia%2FTokyo`
    const response = await fetch(apiUrl)

    if (!response.ok) {
      throw new Error(`Open-Meteo API error: ${response.status}`)
    }
    const weatherData = await response.json()
    const daily = (weatherData?.daily ?? {}) as OpenMeteoDaily

    // 8. weather_cache へ upsert（UNIQUE(profile_id, forecast_date)。実カラムに分解して保存）
    const { error: cacheUpsertError } = await supabase.from('weather_cache').upsert(
      {
        profile_id: body.profileId,
        forecast_date: forecastDate,
        latitude,
        longitude,
        weather_summary: describeWeatherCode(daily.weathercode?.[0]),
        temperature_max: daily.temperature_2m_max?.[0] ?? null,
        temperature_min: daily.temperature_2m_min?.[0] ?? null,
        precipitation_probability: daily.precipitation_probability_max?.[0] ?? null,
        raw_response: weatherData,
        fetched_at: new Date().toISOString(),
      },
      { onConflict: 'profile_id,forecast_date' },
    )

    if (cacheUpsertError) {
      throw new Error(`weather_cache upsert error: ${cacheUpsertError.message}`)
    }

    // 9. 試行記録をapi_successに更新
    await supabase.rpc('update_weather_refresh_attempt_result', {
      p_attempt_id: attemptId,
      p_result: 'api_success',
      p_error_code: null,
    })

    return jsonSuccess({ refreshed: true, forecastDate })
  } catch (apiError) {
    // 10. 失敗時はapi_failedに更新してエラー返却
    const errorMessage = apiError instanceof Error ? apiError.message : String(apiError)

    await supabase.rpc('update_weather_refresh_attempt_result', {
      p_attempt_id: attemptId,
      p_result: 'api_failed',
      p_error_code: errorMessage.slice(0, 200),
    })

    return jsonError(ErrorCode.EXTERNAL_API_ERROR, '天気情報の取得に失敗しました', 502, errorMessage)
  }
})
