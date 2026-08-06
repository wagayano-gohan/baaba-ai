// 認証基盤: 家族アカウント（owner_admin/viewer）のSupabase Authセッションと、
// 本人(principal)端末のデバイス登録状態をアプリ全体へ供給するContext。
//
// ばーばAIには2種類の「認証主体」がある：
//   1. 家族アカウント … Supabase Authのセッション（session / user / memberships / activeProfileId）
//   2. 本人(principal)端末 … localStorageに保存されたデバイストークン（deviceRegistered / deviceProfileId）
// 両者は排他ではなく、家族がowner_adminとしてログインした端末を、そのまま本人用端末として
// 登録する（DeviceSetupScreen）運用もあり得るため、このContextでは双方を並行して保持する。
//
// セッションの永続化・自動リフレッシュは supabase-js のデフォルト挙動（localStorage + autoRefreshToken）
// に委ねる。ここではその状態の購読と、アプリ側で必要な派生状態（memberships / activeRole）の管理のみを行う。

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import type { Session, User } from '@supabase/supabase-js'
import { isSupabaseConfigured, SUPABASE_NOT_CONFIGURED_MESSAGE, supabase } from '../lib/supabase'
import { fetchMyProfileMemberships } from '../lib/membership'
import type { MembershipRole, ProfileMembership } from '../lib/membership'
import { getDeviceProfileId, hasRegisteredDevice } from '../lib/deviceToken'

// 複数profileに所属する家族アカウント向けに、選択中のprofileを端末に永続化する。
// deviceToken.ts のキー命名（baba-ai:*）に揃える。
const ACTIVE_PROFILE_ID_STORAGE_KEY = 'baba-ai:active-profile-id'

export interface AuthContextValue {
  /** Supabase Authのセッション。未ログインならnull。 */
  session: Session | null
  /** ログイン中のユーザー。未ログインならnull。 */
  user: User | null
  /** 初期セッション復元中はtrue。復元完了後にfalseになる。 */
  loading: boolean
  /** Supabase未設定時のエラー文言。設定済みならnull。 */
  configError: string | null

  /** ログイン中ユーザーがアクセスできるprofile一覧。未ログイン時は空配列。 */
  memberships: ProfileMembership[]
  /** memberships取得中はtrue。 */
  membershipsLoading: boolean
  /** memberships取得に失敗した場合のエラー文言。 */
  membershipsError: string | null
  /** 選択中のprofileId。複数profileがある場合の切り替え対象。 */
  activeProfileId: string | null
  /** 選択中のprofileを変更する（localStorageに永続化される）。 */
  setActiveProfileId: (profileId: string | null) => void
  /** activeProfileIdに対応するrole。未選択・該当なしの場合はnull。 */
  activeRole: MembershipRole | null

  /** メールアドレス・パスワードでログインする。失敗時はthrowする。 */
  signIn: (email: string, password: string) => Promise<void>
  /** ログアウトし、memberships・選択中profileをクリアする。 */
  signOut: () => Promise<void>

  /** この端末が本人(principal)用端末として登録済みかどうか。 */
  deviceRegistered: boolean
  /** 登録済みデバイストークンが紐づくprofileId。未登録ならnull。 */
  deviceProfileId: string | null
  /** localStorageのデバイス登録状態を読み直す（登録・解除の直後に呼ぶ）。 */
  refreshDeviceState: () => void
}

const AuthContext = createContext<AuthContextValue | null>(null)

function readStoredActiveProfileId(): string | null {
  try {
    return localStorage.getItem(ACTIVE_PROFILE_ID_STORAGE_KEY)
  } catch {
    return null
  }
}

function writeStoredActiveProfileId(profileId: string | null): void {
  try {
    if (profileId) {
      localStorage.setItem(ACTIVE_PROFILE_ID_STORAGE_KEY, profileId)
    } else {
      localStorage.removeItem(ACTIVE_PROFILE_ID_STORAGE_KEY)
    }
  } catch {
    // localStorageが使えない環境（プライベートブラウジング等）でもアプリは動作させる。
  }
}

interface AuthProviderProps {
  children: ReactNode
}

export function AuthProvider({ children }: AuthProviderProps) {
  const [session, setSession] = useState<Session | null>(null)
  // Supabase未設定時は復元処理自体を行わないため、初期値をその場で確定させる。
  const [loading, setLoading] = useState<boolean>(isSupabaseConfigured)

  const [memberships, setMemberships] = useState<ProfileMembership[]>([])
  const [membershipsLoading, setMembershipsLoading] = useState(false)
  const [membershipsError, setMembershipsError] = useState<string | null>(null)
  const [activeProfileIdState, setActiveProfileIdState] = useState<string | null>(
    readStoredActiveProfileId,
  )

  const [deviceRegistered, setDeviceRegistered] = useState<boolean>(() => hasRegisteredDevice())
  const [deviceProfileId, setDeviceProfileId] = useState<string | null>(() => getDeviceProfileId())

  const configError = isSupabaseConfigured ? null : SUPABASE_NOT_CONFIGURED_MESSAGE

  // 1. 初期セッションの復元 + 以降のセッション変化の購読。
  useEffect(() => {
    if (!isSupabaseConfigured) {
      // 未設定時はクラッシュさせず、未ログイン扱いのまま起動だけはできるようにする。
      setSession(null)
      setLoading(false)
      return
    }

    let cancelled = false

    void supabase.auth
      .getSession()
      .then(({ data }) => {
        if (cancelled) return
        setSession(data.session)
      })
      .catch(() => {
        if (cancelled) return
        setSession(null)
      })
      .finally(() => {
        if (cancelled) return
        setLoading(false)
      })

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      if (cancelled) return
      setSession(nextSession)
      // onAuthStateChangeはINITIAL_SESSIONでも発火するため、ここでも復元完了とみなす。
      setLoading(false)
    })

    return () => {
      cancelled = true
      subscription.unsubscribe()
    }
  }, [])

  const userId = session?.user?.id ?? null

  // 2. セッション確立時にmembershipsを取得し、ログアウト時はクリアする。
  useEffect(() => {
    if (!userId || !isSupabaseConfigured) {
      setMemberships([])
      setMembershipsLoading(false)
      setMembershipsError(null)
      return
    }

    let cancelled = false
    setMembershipsLoading(true)
    setMembershipsError(null)

    void fetchMyProfileMemberships()
      .then((rows) => {
        if (cancelled) return
        setMemberships(rows)
      })
      .catch((error: unknown) => {
        if (cancelled) return
        setMemberships([])
        setMembershipsError(
          error instanceof Error ? error.message : 'アクセス可能な家族情報の取得に失敗しました',
        )
      })
      .finally(() => {
        if (cancelled) return
        setMembershipsLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [userId])

  // 3. memberships取得後、選択中profileの整合性を保つ。
  //    保存済みの選択が現在のmembershipsに存在しない（権限剥奪・別アカウントでログイン等）場合は
  //    先頭のprofileへフォールバックする。
  useEffect(() => {
    if (memberships.length === 0) return
    const stillValid = activeProfileIdState
      ? memberships.some((m) => m.profileId === activeProfileIdState)
      : false
    if (stillValid) return
    const fallback = memberships[0].profileId
    setActiveProfileIdState(fallback)
    writeStoredActiveProfileId(fallback)
  }, [memberships, activeProfileIdState])

  const setActiveProfileId = useCallback((profileId: string | null) => {
    setActiveProfileIdState(profileId)
    writeStoredActiveProfileId(profileId)
  }, [])

  const activeRole = useMemo<MembershipRole | null>(() => {
    if (!activeProfileIdState) return null
    return memberships.find((m) => m.profileId === activeProfileIdState)?.role ?? null
  }, [memberships, activeProfileIdState])

  const signIn = useCallback(async (email: string, password: string) => {
    if (!isSupabaseConfigured) {
      throw new Error(SUPABASE_NOT_CONFIGURED_MESSAGE)
    }
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    // 呼び出し側（LoginScreen）が error.code / message を見て文言を出し分けられるよう、
    // Supabaseのエラーをそのまま投げる。
    if (error) throw error
  }, [])

  const signOut = useCallback(async () => {
    if (isSupabaseConfigured) {
      await supabase.auth.signOut()
    }
    setSession(null)
    setMemberships([])
    setMembershipsError(null)
    setActiveProfileIdState(null)
    writeStoredActiveProfileId(null)
    // デバイストークンは端末そのものの資格情報であり、家族アカウントのログアウトでは消さない
    // （本人用端末として登録済みの端末で家族がログアウトしても、本人の利用は継続できる必要があるため）。
  }, [])

  const refreshDeviceState = useCallback(() => {
    setDeviceRegistered(hasRegisteredDevice())
    setDeviceProfileId(getDeviceProfileId())
  }, [])

  const value = useMemo<AuthContextValue>(
    () => ({
      session,
      user: session?.user ?? null,
      loading,
      configError,
      memberships,
      membershipsLoading,
      membershipsError,
      activeProfileId: activeProfileIdState,
      setActiveProfileId,
      activeRole,
      signIn,
      signOut,
      deviceRegistered,
      deviceProfileId,
      refreshDeviceState,
    }),
    [
      session,
      loading,
      configError,
      memberships,
      membershipsLoading,
      membershipsError,
      activeProfileIdState,
      setActiveProfileId,
      activeRole,
      signIn,
      signOut,
      deviceRegistered,
      deviceProfileId,
      refreshDeviceState,
    ],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

/** AuthProvider配下でのみ利用できる認証状態フック。 */
export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext)
  if (!context) {
    throw new Error('useAuth は AuthProvider の内側で使用してください')
  }
  return context
}
