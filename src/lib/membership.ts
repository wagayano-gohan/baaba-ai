// 家族アカウント認証: ログイン中のSupabase Authユーザーがアクセス可能な
// profile_id一覧・role(owner_admin/viewer)を取得する。
// profile_memberships のSELECT RLSは「自分の行 or 対象profileのowner_admin」のみ許可されているため、
// ここでは常に「自分(auth_user_id=自分)の行」を取得すれば、自分が所属する全profileが取得できる。

import { isSupabaseConfigured, SUPABASE_NOT_CONFIGURED_MESSAGE, supabase } from './supabase'

export type MembershipRole = 'owner_admin' | 'viewer'

export interface ProfileMembership {
  membershipId: string
  profileId: string
  role: MembershipRole
  profileName: string | null
  /** profiles.address。「近くの〜」検索の基準地点に使う。未登録ならnull。 */
  profileAddress: string | null
}

function ensureConfigured(): void {
  if (!isSupabaseConfigured) {
    throw new Error(SUPABASE_NOT_CONFIGURED_MESSAGE)
  }
}

function toMembershipError(error: unknown): Error {
  if (error instanceof Error) return error
  if (error && typeof error === 'object') {
    const e = error as { message?: string; code?: string; details?: string; hint?: string }
    const parts = [e.message || 'Supabaseエラー']
    if (e.code) parts.push(`code: ${e.code}`)
    if (e.details) parts.push(`details: ${e.details}`)
    if (e.hint) parts.push(`hint: ${e.hint}`)
    return new Error(parts.join(' / '))
  }
  return new Error(String(error))
}

interface MembershipRow {
  membership_id: string
  profile_id: string
  role: MembershipRole
  profiles:
    | { full_name: string; address: string | null }
    | { full_name: string; address: string | null }[]
    | null
}

/**
 * ログイン中の自分（auth_user_id）がアクセス可能な profile_id 一覧・roleを取得する。
 * 未ログインの場合はエラーを投げる。
 */
export async function fetchMyProfileMemberships(): Promise<ProfileMembership[]> {
  ensureConfigured()

  const { data: userData, error: userError } = await supabase.auth.getUser()
  if (userError || !userData.user) {
    throw new Error('ログインしていません')
  }

  const { data, error } = await supabase
    .from('profile_memberships')
    .select('membership_id, profile_id, role, profiles(full_name, address)')
    .eq('auth_user_id', userData.user.id)
    .order('created_at', { ascending: true })

  if (error) throw toMembershipError(error)

  return ((data ?? []) as unknown as MembershipRow[]).map((row) => {
    const profile = Array.isArray(row.profiles) ? row.profiles[0] : row.profiles
    return {
      membershipId: row.membership_id,
      profileId: row.profile_id,
      role: row.role,
      profileName: profile?.full_name ?? null,
      profileAddress: profile?.address ?? null,
    }
  })
}
