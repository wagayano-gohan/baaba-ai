// 設定メニュー画面。
//
// ホーム画面下部の「設定」から入る、ご家族・管理者向けの入口。
// ご本人が日常的に使う機能（お薬・荷物・予定・買い物メモなど）はすべてホーム画面に
// 置いてあるため、ここには重複して置かない。ここに置くのは
// 「ご家族の管理画面」「本人端末の設定」「管理者PIN」「ログイン情報」の4つに絞る。

import { useCallback, useState } from 'react'
import { useAuth } from '../contexts/AuthContext'
import './Phase2MenuScreen.css'

interface Phase2MenuScreenProps {
  /** 「ホームに戻る」を押したとき。ホーム画面の「設定」から入ったときに渡される。 */
  onBack?: () => void
  /** 「話しかける（音声入力）」を押したとき。 */
  onGoVoice: () => void
  /** 「AIに相談」を押したとき。 */
  onGoChat: () => void
  /** 「ご家族の管理画面」を押したとき。家族アカウントでログイン中のみ渡される。 */
  onGoFamily?: () => void
  /** 「本人端末の設定」を押したとき。 */
  onGoDeviceSetup: () => void
  /** 「管理者PINを設定する」を押したとき。owner_adminのときだけ表示される。 */
  onGoPinSetup?: () => void
  /** 「管理者PINを確認する」を押したとき。owner_adminのときだけ表示される。 */
  onGoPinVerify?: () => void
  /** 「PINを忘れた場合の再設定」を押したとき。owner_adminのときだけ表示される。 */
  onGoPinReset?: () => void
}

const ROLE_LABELS: Record<string, string> = {
  owner_admin: '管理者',
  viewer: '閲覧のみ',
}

export function Phase2MenuScreen({
  onBack,
  onGoVoice,
  onGoChat,
  onGoFamily,
  onGoDeviceSetup,
  onGoPinSetup,
  onGoPinVerify,
  onGoPinReset,
}: Phase2MenuScreenProps) {
  const {
    user,
    memberships,
    membershipsLoading,
    membershipsError,
    activeProfileId,
    activeRole,
    signOut,
    deviceRegistered,
  } = useAuth()

  const [signingOut, setSigningOut] = useState(false)

  const activeMembership = memberships.find((m) => m.profileId === activeProfileId) ?? null

  // 管理者PIN関連は、家族アカウントでログイン中かつ選択中の家族に対してowner_adminの場合のみ表示する。
  // 対象の家族が選ばれていない場合はactiveRoleがnullになるため、この条件で未選択時の操作も防げる。
  const canManagePin = Boolean(user) && Boolean(activeProfileId) && activeRole === 'owner_admin'
  const showPinSection = canManagePin && Boolean(onGoPinSetup ?? onGoPinVerify ?? onGoPinReset)

  const handleSignOut = useCallback(() => {
    if (signingOut) return
    setSigningOut(true)
    void signOut().finally(() => setSigningOut(false))
  }, [signOut, signingOut])

  return (
    <div className="phase2-menu">
      {onBack && (
        <button type="button" className="phase2-menu__back tap-feedback" onClick={onBack}>
          ← ホームに戻る
        </button>
      )}

      <header className="phase2-menu__header">
        <h1 className="phase2-menu__heading">ばーばAI</h1>
        <p className="phase2-menu__lead">操作を選択してください</p>
      </header>

      {deviceRegistered && (
        <p className="phase2-menu__device-badge">この端末はご本人用として設定されています</p>
      )}

      <div className="phase2-menu__buttons">
        <button
          type="button"
          className="phase2-menu__button phase2-menu__button--primary tap-feedback"
          onClick={onGoVoice}
        >
          話しかける（音声入力）
        </button>

        <button
          type="button"
          className="phase2-menu__button phase2-menu__button--primary tap-feedback"
          onClick={onGoChat}
        >
          AIに相談
        </button>

        {onGoFamily && (
          <button
            type="button"
            className="phase2-menu__button phase2-menu__button--secondary tap-feedback"
            onClick={onGoFamily}
          >
            ご家族の管理画面
          </button>
        )}

        <button
          type="button"
          className="phase2-menu__button phase2-menu__button--secondary tap-feedback"
          onClick={onGoDeviceSetup}
        >
          本人端末の設定
        </button>
      </div>

      {showPinSection && (
        <section className="phase2-menu__admin">
          <h2 className="phase2-menu__admin-title">管理者メニュー</h2>
          <p className="phase2-menu__admin-note">
            ご本人用端末の登録など、重要な操作には管理者PIN（数字4桁）の確認が必要です。
          </p>
          <div className="phase2-menu__admin-buttons">
            {onGoPinSetup && (
              <button
                type="button"
                className="phase2-menu__admin-button tap-feedback"
                onClick={onGoPinSetup}
              >
                管理者PINを設定する
              </button>
            )}
            {onGoPinVerify && (
              <button
                type="button"
                className="phase2-menu__admin-button tap-feedback"
                onClick={onGoPinVerify}
              >
                管理者PINを確認する
              </button>
            )}
            {onGoPinReset && (
              <button
                type="button"
                className="phase2-menu__admin-button tap-feedback"
                onClick={onGoPinReset}
              >
                PINを忘れた場合の再設定
              </button>
            )}
          </div>
        </section>
      )}

      {user && (
        <section className="phase2-menu__account">
          <h2 className="phase2-menu__account-title">ログイン中のアカウント</h2>
          <p className="phase2-menu__account-row">{user.email ?? 'メールアドレス不明'}</p>

          {membershipsLoading && <p className="phase2-menu__account-row">読み込んでいます…</p>}

          {!membershipsLoading && membershipsError && (
            <p className="phase2-menu__account-error">{membershipsError}</p>
          )}

          {!membershipsLoading && !membershipsError && (
            <p className="phase2-menu__account-row">
              {activeMembership
                ? `${activeMembership.profileName ?? activeMembership.profileId}（${
                    ROLE_LABELS[activeRole ?? ''] ?? activeRole ?? '権限不明'
                  }）`
                : '対象のご家族が選択されていません'}
            </p>
          )}

          <button
            type="button"
            className="phase2-menu__signout tap-feedback"
            onClick={handleSignOut}
            disabled={signingOut}
          >
            {signingOut ? 'ログアウトしています…' : 'ログアウト'}
          </button>
        </section>
      )}
    </div>
  )
}
