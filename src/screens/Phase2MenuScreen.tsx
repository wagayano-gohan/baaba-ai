// Phase2の動作確認用メニュー画面。
//
// これはPhase3で作る「ホーム画面」ではない。Phase2で実装した3基盤
// （①認証 ②音声 ③AIチャット）を人手で動作確認するための、最小限の入口である。
// 予定/ToDo/薬/荷物/写真/地図/天気などのPhase3以降の要素は一切含まない。

import { useCallback, useState } from 'react'
import { useAuth } from '../contexts/AuthContext'
import './Phase2MenuScreen.css'

interface Phase2MenuScreenProps {
  /** 「おはなしする（音声）」を押したとき。 */
  onGoVoice: () => void
  /** 「AIとチャット」を押したとき。 */
  onGoChat: () => void
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
  viewer: '見るだけ',
}

export function Phase2MenuScreen({
  onGoVoice,
  onGoChat,
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
      <header className="phase2-menu__header">
        <h1 className="phase2-menu__heading">ばーばAI</h1>
        <p className="phase2-menu__lead">やりたいことを えらんでください</p>
      </header>

      {deviceRegistered && (
        <p className="phase2-menu__device-badge">この端末は本人用です</p>
      )}

      <div className="phase2-menu__buttons">
        <button
          type="button"
          className="phase2-menu__button phase2-menu__button--primary tap-feedback"
          onClick={onGoVoice}
        >
          おはなしする（音声）
        </button>

        <button
          type="button"
          className="phase2-menu__button phase2-menu__button--primary tap-feedback"
          onClick={onGoChat}
        >
          AIとチャット
        </button>

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
            本人端末の登録などの大事な操作には、管理者PIN（数字4桁）の確認が必要です。
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
                : '対象の家族が選ばれていません'}
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
