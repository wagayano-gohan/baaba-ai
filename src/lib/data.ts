// 画面データの取得・更新をまとめたクライアント側API。
//
// すべて get-today-events Edge Function（読み書きゲートウェイ）を経由する。
// 各テーブルのRLSは `to authenticated` のため、Supabase Authアカウントを持たない
// 本人(principal)端末からはクライアント直接アクセスができないためである。
// 本人端末（デバイストークン）でも家族アカウント（JWT）でも同じ関数で動作する。

import { callFlexibleAuthedFunction } from './apiClient'

const FUNCTION_NAME = 'get-today-events'

// --- 共通の日時ユーティリティ -------------------------------------------

const WEEKDAY_KANJI = ['日', '月', '火', '水', '木', '金', '土']

/** 曜日番号(0=日)を漢字1文字にする。 */
export function weekdayKanji(weekday: number): string {
  return WEEKDAY_KANJI[weekday] ?? ''
}

/** UTCのISO文字列から、JST基準の YYYY-MM-DD を返す。 */
export function jstDateKey(utcIso: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(utcIso))
}

/** 「今日」のJST基準 YYYY-MM-DD。offsetDaysで前後にずらせる。 */
export function jstTodayKey(offsetDays = 0): string {
  const base = new Date(Date.now() + offsetDays * 86_400_000)
  return jstDateKey(base.toISOString())
}

/** JSTの曜日番号（日曜=0）。offsetDaysで翌日以降も取れる。 */
export function jstWeekday(offsetDays = 0): number {
  const [year, month, day] = jstTodayKey(offsetDays).split('-').map(Number)
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay()
}

/** JSTの「YYYY-MM-DD」と「HH:MM」からUTCのISO文字列を作る（フォーム入力の保存用）。 */
export function jstInputToUtcIso(dateText: string, timeText: string | null): string {
  const [year, month, day] = dateText.split('-').map(Number)
  const [hour, minute] = (timeText && timeText !== '' ? timeText : '00:00').split(':').map(Number)
  // JSTの壁時計時刻をUTCとして組み立ててから9時間戻すとUTCの実時刻になる。
  return new Date(Date.UTC(year, month - 1, day, hour, minute) - 9 * 60 * 60_000).toISOString()
}

/** UTCのISO文字列を、JSTの「9:30」形式にする。0:00は時刻未指定とみなす。 */
export function formatTimeLabel(utcIso: string | null): string {
  if (!utcIso) return '時刻未定'
  const parsed = new Date(utcIso)
  if (Number.isNaN(parsed.getTime())) return '時刻未定'

  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Tokyo',
    hour: 'numeric',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(parsed)
  const pick = (type: string) => parts.find((p) => p.type === type)?.value ?? ''

  const hour = Number(pick('hour')) % 24
  const minute = pick('minute')
  if (Number.isNaN(hour) || minute === '') return '時刻未定'
  if (hour === 0 && minute === '00') return '時刻未定'
  return `${hour}:${minute}`
}

/** UTCのISO文字列を「8月12日（水）」形式にする。 */
export function formatDateLabel(utcIso: string | null): string {
  if (!utcIso) return ''
  const parsed = new Date(utcIso)
  if (Number.isNaN(parsed.getTime())) return ''
  const [year, month, day] = jstDateKey(utcIso).split('-').map(Number)
  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay()
  return `${month}月${day}日（${WEEKDAY_KANJI[weekday]}）`
}

/** 「8月12日（水） 15:00」形式。時刻未指定なら日付のみ。 */
export function formatDateTimeLabel(utcIso: string | null): string {
  if (!utcIso) return ''
  const date = formatDateLabel(utcIso)
  const time = formatTimeLabel(utcIso)
  return time === '時刻未定' ? date : `${date} ${time}`
}

/** 「今日」「明日」「8月15日（土）」のうち、いちばん分かりやすい表記を返す。 */
export function formatRelativeDateLabel(utcIso: string | null): string {
  if (!utcIso) return ''
  const key = jstDateKey(utcIso)
  if (key === jstTodayKey(0)) return '今日'
  if (key === jstTodayKey(1)) return '明日'
  return formatDateLabel(utcIso)
}

// --- 型 -----------------------------------------------------------------

export interface EventItem {
  id: string
  title: string
  startsAt: string
  category: string
  locationText: string | null
}

export interface TaskItem {
  id: string
  title: string
  category: string
  dueAt: string | null
  status: string
}

export interface MedicationItem {
  id: string
  medicationName: string
  dosage: string | null
  scheduledAt: string
  status: 'scheduled' | 'taken' | 'skipped' | 'missed' | string
  takenAt: string | null
}

export interface DeliveryItem {
  id: string
  itemName: string
  carrier: string | null
  status: string
  expectedAt: string | null
  memo: string | null
}

export interface ContactItem {
  id: string
  name: string
  relationship: string | null
  phoneNumber: string | null
  isFavorite: boolean
  memo: string | null
}

export interface LocationItem {
  id: string
  name: string
  category: string
  address: string | null
  latitude: number | null
  longitude: number | null
  memo: string | null
}

export interface NoteItem {
  id: string
  title: string | null
  body: string | null
  hasImage: boolean
  createdAt: string
}

/** 曜日番号(文字列 '0'〜'6')→ゴミの種類。 */
export type GarbageSchedule = Record<string, string>

export interface AppSettings {
  garbage: GarbageSchedule
}

export interface HomeLocation {
  name: string
  address: string | null
  latitude: number | null
  longitude: number | null
}

export interface HomeData {
  events: EventItem[]
  medications: MedicationItem[]
  deliveries: DeliveryItem[]
  openTaskCount: number
  garbage: { today: string | null; tomorrow: string | null }
  home: HomeLocation | null
}

// --- 呼び出し -----------------------------------------------------------

function call<T>(profileId: string | null, payload: Record<string, unknown>): Promise<T> {
  return callFlexibleAuthedFunction<T>(FUNCTION_NAME, {
    // 本人端末ではデバイストークンから対象profileが決まるため、送っても無視される。
    profileId: profileId ?? undefined,
    ...payload,
  })
}

/** ホーム画面が必要とするものを1回で取得する。 */
export async function fetchHome(profileId: string | null): Promise<HomeData> {
  const data = await call<Partial<HomeData>>(profileId, { scope: 'home' })
  return {
    events: data.events ?? [],
    medications: data.medications ?? [],
    deliveries: data.deliveries ?? [],
    openTaskCount: data.openTaskCount ?? 0,
    garbage: data.garbage ?? { today: null, tomorrow: null },
    home: data.home ?? null,
  }
}

export async function fetchMedications(profileId: string | null): Promise<MedicationItem[]> {
  const data = await call<{ medications?: MedicationItem[] }>(profileId, { scope: 'medications' })
  return data.medications ?? []
}

export async function fetchDeliveries(profileId: string | null): Promise<DeliveryItem[]> {
  const data = await call<{ deliveries?: DeliveryItem[] }>(profileId, { scope: 'deliveries' })
  return data.deliveries ?? []
}

export async function fetchContacts(profileId: string | null): Promise<ContactItem[]> {
  const data = await call<{ contacts?: ContactItem[] }>(profileId, { scope: 'contacts' })
  return data.contacts ?? []
}

export async function fetchLocations(profileId: string | null): Promise<LocationItem[]> {
  const data = await call<{ locations?: LocationItem[] }>(profileId, { scope: 'locations' })
  return data.locations ?? []
}

export async function fetchNotes(profileId: string | null): Promise<NoteItem[]> {
  const data = await call<{ notes?: NoteItem[] }>(profileId, { scope: 'notes' })
  return data.notes ?? []
}

export async function fetchEvents(profileId: string | null): Promise<EventItem[]> {
  const data = await call<{ events?: EventItem[] }>(profileId, { scope: 'events' })
  return data.events ?? []
}

export async function fetchTasks(profileId: string | null): Promise<TaskItem[]> {
  const data = await call<{ tasks?: TaskItem[] }>(profileId, { scope: 'tasks' })
  return data.tasks ?? []
}

export async function fetchSettings(
  profileId: string | null,
): Promise<{ settings: AppSettings; home: (HomeLocation & { id: string }) | null }> {
  const data = await call<{
    settings?: AppSettings
    home?: (HomeLocation & { id: string }) | null
  }>(profileId, { scope: 'settings' })
  return { settings: data.settings ?? { garbage: {} }, home: data.home ?? null }
}

// --- 更新 ---------------------------------------------------------------

export function takeMedication(profileId: string | null, medicationLogId: string): Promise<unknown> {
  return call(profileId, { action: 'take_medication', medicationLogId })
}

export function addMedication(
  profileId: string | null,
  input: { medicationName: string; dosage?: string | null; times: string[]; days: number },
): Promise<unknown> {
  return call(profileId, { action: 'add_medication', ...input })
}

export function deleteMedication(profileId: string | null, medicationName: string): Promise<unknown> {
  return call(profileId, { action: 'delete_medication', medicationName })
}

export function receiveDelivery(profileId: string | null, deliveryId: string): Promise<unknown> {
  return call(profileId, { action: 'receive_delivery', deliveryId })
}

export function addDelivery(
  profileId: string | null,
  input: { itemName: string; carrier?: string | null; expectedAt?: string | null; memo?: string | null },
): Promise<unknown> {
  return call(profileId, { action: 'add_delivery', ...input })
}

export function deleteDelivery(profileId: string | null, deliveryId: string): Promise<unknown> {
  return call(profileId, { action: 'delete_delivery', deliveryId })
}

export function addContact(
  profileId: string | null,
  input: {
    name: string
    relationship?: string | null
    phoneNumber?: string | null
    isFavorite?: boolean
    memo?: string | null
  },
): Promise<unknown> {
  return call(profileId, { action: 'add_contact', ...input })
}

export function deleteContact(profileId: string | null, contactId: string): Promise<unknown> {
  return call(profileId, { action: 'delete_contact', contactId })
}

export function addLocation(
  profileId: string | null,
  input: {
    name: string
    category: string
    address?: string | null
    latitude?: number | null
    longitude?: number | null
    memo?: string | null
  },
): Promise<unknown> {
  return call(profileId, { action: 'add_location', ...input })
}

export function deleteLocation(profileId: string | null, locationId: string): Promise<unknown> {
  return call(profileId, { action: 'delete_location', locationId })
}

export function addNote(
  profileId: string | null,
  input: { title?: string | null; body?: string | null },
): Promise<{ id: string }> {
  return call<{ id: string }>(profileId, { action: 'add_note', ...input })
}

export function deleteNote(profileId: string | null, noteId: string): Promise<unknown> {
  return call(profileId, { action: 'delete_note', noteId })
}

export function fetchNoteImageUrl(profileId: string | null, noteId: string): Promise<{ signedUrl: string }> {
  return call<{ signedUrl: string }>(profileId, { action: 'note_image_url', noteId })
}

export function addEvent(
  profileId: string | null,
  input: { title: string; startsAt: string; category?: string; locationText?: string | null },
): Promise<{ id: string }> {
  return call<{ id: string }>(profileId, { action: 'add_event', ...input })
}

export function deleteEvent(profileId: string | null, eventId: string): Promise<unknown> {
  return call(profileId, { action: 'delete_event', eventId })
}

export function addTask(
  profileId: string | null,
  input: { title: string; category?: string; dueAt?: string | null },
): Promise<{ id: string }> {
  return call<{ id: string }>(profileId, { action: 'add_task', ...input })
}

export function deleteTask(profileId: string | null, taskId: string): Promise<unknown> {
  return call(profileId, { action: 'delete_task', taskId })
}

export function saveSettings(profileId: string | null, garbage: GarbageSchedule): Promise<unknown> {
  return call(profileId, { action: 'save_settings', garbage })
}

// --- 天気（Open-Meteo。APIキー不要・CORS対応） --------------------------

export interface WeatherToday {
  /** 「晴れ」「くもり」など。 */
  summary: string
  /** WMO weather code。アイコン出し分けに使う。 */
  code: number
  maxTemp: number | null
  minTemp: number | null
  /** 降水確率(%)。 */
  rainChance: number | null
  /** 服装・持ち物のひとことアドバイス。 */
  advice: string
}

/** WMO weather code を日本語の天気表現にする。 */
export function describeWeatherCode(code: number): string {
  if (code === 0) return '晴れ'
  if (code === 1) return 'おおむね晴れ'
  if (code === 2) return '晴れときどきくもり'
  if (code === 3) return 'くもり'
  if (code === 45 || code === 48) return '霧'
  if (code >= 51 && code <= 57) return '小雨'
  if (code >= 61 && code <= 67) return '雨'
  if (code >= 71 && code <= 77) return '雪'
  if (code >= 80 && code <= 82) return 'にわか雨'
  if (code === 85 || code === 86) return 'にわか雪'
  if (code >= 95) return '雷雨'
  return '天気の情報'
}

/** 気温と降水確率から、服装・持ち物のひとことを組み立てる。 */
export function buildWeatherAdvice(
  code: number,
  maxTemp: number | null,
  rainChance: number | null,
): string {
  const parts: string[] = []

  if (maxTemp !== null) {
    if (maxTemp >= 30) parts.push('とても暑くなります。涼しい服装で、水分をこまめに取ってください')
    else if (maxTemp >= 25) parts.push('暑くなります。半袖でちょうどよい陽気です')
    else if (maxTemp >= 20) parts.push('過ごしやすい気温です。薄手の上着があると安心です')
    else if (maxTemp >= 12) parts.push('少し肌寒いので、上着を1枚持って出かけてください')
    else if (maxTemp >= 5) parts.push('寒くなります。コートやマフラーをお使いください')
    else parts.push('とても寒くなります。厚手のコートと手袋をお使いください')
  }

  const rainy = (rainChance !== null && rainChance >= 50) || (code >= 51 && code <= 82) || code >= 95
  if (rainy) parts.push('傘を持って出かけてください')
  else if (rainChance !== null && rainChance >= 30) parts.push('折りたたみ傘があると安心です')

  return parts.join('。') || '今日の服装は、いつもどおりで大丈夫です'
}

interface OpenMeteoResponse {
  daily?: {
    weathercode?: number[]
    temperature_2m_max?: number[]
    temperature_2m_min?: number[]
    precipitation_probability_max?: number[]
  }
}

/**
 * 指定地点の今日の天気を取得する。
 * Open-Meteoは無料・APIキー不要・CORS許可のため、ブラウザから直接呼び出す。
 */
export async function fetchTodayWeather(
  latitude: number,
  longitude: number,
): Promise<WeatherToday> {
  const url =
    `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}` +
    `&daily=weathercode,temperature_2m_max,temperature_2m_min,precipitation_probability_max` +
    `&timezone=Asia%2FTokyo&forecast_days=1`

  const res = await fetch(url)
  if (!res.ok) throw new Error('天気を取得できませんでした')
  const json = (await res.json()) as OpenMeteoResponse
  const daily = json.daily ?? {}

  const code = daily.weathercode?.[0] ?? 3
  const maxTemp = daily.temperature_2m_max?.[0] ?? null
  const minTemp = daily.temperature_2m_min?.[0] ?? null
  const rainChance = daily.precipitation_probability_max?.[0] ?? null

  return {
    summary: describeWeatherCode(code),
    code,
    maxTemp: maxTemp === null ? null : Math.round(maxTemp),
    minTemp: minTemp === null ? null : Math.round(minTemp),
    rainChance,
    advice: buildWeatherAdvice(code, maxTemp, rainChance),
  }
}

export interface GeocodeResult {
  name: string
  latitude: number
  longitude: number
  /** 「神奈川県 横浜市」など、絞り込み用の補足。 */
  detail: string
}

/** 地名から緯度経度を調べる（Open-Meteo Geocoding。APIキー不要・CORS対応）。 */
export async function geocodePlace(query: string): Promise<GeocodeResult[]> {
  const url =
    `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(query)}` +
    `&count=5&language=ja&format=json`
  const res = await fetch(url)
  if (!res.ok) throw new Error('地名を調べられませんでした')
  const json = (await res.json()) as {
    results?: { name: string; latitude: number; longitude: number; admin1?: string; country?: string }[]
  }
  return (json.results ?? []).map((r) => ({
    name: r.name,
    latitude: r.latitude,
    longitude: r.longitude,
    detail: [r.country, r.admin1].filter(Boolean).join(' '),
  }))
}

// --- 地図アプリを開くURL ------------------------------------------------

/**
 * 地図アプリで経路案内を開くURLを作る。
 * iPhone・Androidどちらでも動くよう、Googleマップのユニバーサルリンクを使う。
 */
export function buildDirectionsUrl(target: {
  name: string
  address: string | null
  latitude: number | null
  longitude: number | null
}): string {
  const destination =
    target.latitude !== null && target.longitude !== null
      ? `${target.latitude},${target.longitude}`
      : (target.address ?? target.name)
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(destination)}&travelmode=transit`
}

/** 地図アプリで場所を表示するURLを作る。 */
export function buildMapUrl(target: {
  name: string
  address: string | null
  latitude: number | null
  longitude: number | null
}): string {
  const query =
    target.latitude !== null && target.longitude !== null
      ? `${target.latitude},${target.longitude}`
      : (target.address ?? target.name)
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`
}
