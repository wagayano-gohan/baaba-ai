// 本人(principal)端末のセットアップ画面。
// この端末を「おばあちゃんが使う端末」として登録し、デバイストークンをlocalStorageへ保存する。
//
// 手段は2つある：
//  (A) owner_adminとしてこの端末でログインし、register-device Edge Functionを直接呼んで登録する
//      （生トークンはこのレスポンスでのみ取得できるため、その場で保存する）
//      この経路には有効なPIN確認セッション（verify-admin-pin成功から10分以内）が必要で、
//      無い場合サーバーは PIN_REQUIRED を返す。その場合は onNeedPinVerify でPIN確認画面へ誘導する。
//  (B) 別端末で発行済みのデバイストークン + profileId を手入力して保存する
//      （owner_adminのPC等でregister-deviceを実行し、表示された値を本人端末へ転記する運用）

import { useState } from 'react'
import type { FormEvent } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { callUserAuthedFunction, ApiCallError } from '../lib/apiClient'
import { clearDeviceCredential, saveDeviceCredential } from '../lib/deviceToken'
import './DeviceSetupScreen.css'

interface DeviceSetupScreenProps {
  /** 登録完了・解除完了後に「終わる」を押したときに呼ばれる。 */
  onDone?: () => void
  /** 戻る導線。渡された場合のみ表示する。 */
  onBack?: () => void
  /** register-deviceがPIN_REQUIREDを返した場合に、PIN確認画面（PinVerifyScreen）へ誘導するために呼ぶ。 */
  onNeedPinVerify?: () => void
}

// register-device Edge Function のレスポンス（supabase/functions/register-device/index.ts 参照）。
interface RegisterDeviceResponse {
  deviceId: string
  profileId: string
  deviceToken: string
}

function toJapaneseRegisterMessage(error: unknown): string {
  if (error instanceof ApiCallError) {
    if (error.code === 'PIN_REQUIRED') {
      return '管理者PINの確認が必要です。管理者PINを入力してから、もう一度登録してください'
    }
    if (error.code === 'PIN_NOT_SET') {
      return '管理者PINがまだ設定されていません。さきに管理者PINを設定してください'
    }
    if (error.code === 'UNAUTHENTICATED') {
      return 'ログインが必要です。ご家族のアカウントでログインしてください'
    }
    if (error.code === 'PROFILE_ACCESS_DENIED') {
      return 'この操作を行う権限がありません（管理者のアカウントが必要です）'
    }
    return error.message
  }
  return error instanceof Error ? error.message : String(error)
}

export function DeviceSetupScreen({ onDone, onBack, onNeedPinVerify }: DeviceSetupScreenProps) {
  const {
    user,
    memberships,
    membershipsLoading,
    deviceRegistered,
    deviceProfileId,
    refreshDeviceState,
    configError,
  } = useAuth()

  const ownerAdminMemberships = memberships.filter((m) => m.role === 'owner_admin')

  // (A) owner_adminとしての登録フォーム
  const [selectedProfileId, setSelectedProfileId] = useState('')
  const [deviceName, setDeviceName] = useState('')
  const [registering, setRegistering] = useState(false)
  const [registerError, setRegisterError] = useState<string | null>(null)
  const [registerSuccess, setRegisterSuccess] = useState(false)
  // PIN確認セッションが無い（PIN_REQUIRED）ためにサーバーが登録を拒否した状態。
  const [pinRequired, setPinRequired] = useState(false)

  // (B) 手入力フォーム
  const [manualToken, setManualToken] = useState('')
  const [manualProfileId, setManualProfileId] = useState('')
  const [manualError, setManualError] = useState<string | null>(null)
  const [manualSuccess, setManualSuccess] = useState(false)

  const effectiveProfileId = selectedProfileId || ownerAdminMemberships[0]?.profileId || ''

  const handleRegister = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (registering) return

    setRegisterError(null)
    setRegisterSuccess(false)
    setPinRequired(false)

    if (!effectiveProfileId) {
      setRegisterError('登録先の家族（プロフィール）を選択してください')
      return
    }

    setRegistering(true)
    try {
      const result = await callUserAuthedFunction<RegisterDeviceResponse>('register-device', {
        profileId: effectiveProfileId,
        deviceName: deviceName.trim() || undefined,
      })
      // 生トークンはこのレスポンスでのみ取得できるため、即座に端末へ保存する。
      saveDeviceCredential(result.deviceToken, result.profileId)
      refreshDeviceState()
      setRegisterSuccess(true)
      setDeviceName('')
    } catch (error) {
      // PIN確認セッションが切れている／まだ取っていない場合は、PIN確認画面への導線を出す。
      if (error instanceof ApiCallError && error.code === 'PIN_REQUIRED') {
        setPinRequired(true)
      }
      setRegisterError(toJapaneseRegisterMessage(error))
    } finally {
      setRegistering(false)
    }
  }

  const handleManualSave = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setManualError(null)
    setManualSuccess(false)

    const token = manualToken.trim()
    const profileId = manualProfileId.trim()
    if (!token || !profileId) {
      setManualError('デバイストークンとプロフィールIDの両方を入力してください')
      return
    }

    saveDeviceCredential(token, profileId)
    refreshDeviceState()
    setManualSuccess(true)
    setManualToken('')
    setManualProfileId('')
  }

  const handleClear = () => {
    clearDeviceCredential()
    refreshDeviceState()
    setRegisterSuccess(false)
    setManualSuccess(false)
    setPinRequired(false)
  }

  return (
    <div className="device-setup">
      <header className="device-setup__header">
        {onBack && (
          <button type="button" className="device-setup__back tap-feedback" onClick={onBack}>
            戻る
          </button>
        )}
        <h1 className="device-setup__heading">本人用端末の設定</h1>
      </header>

      {configError && <p className="device-setup__alert">{configError}</p>}

      {deviceRegistered ? (
        <section className="device-setup__section device-setup__section--registered">
          <p className="device-setup__registered-text">この端末は本人用として登録済みです</p>
          {deviceProfileId && (
            <p className="device-setup__registered-sub">プロフィールID: {deviceProfileId}</p>
          )}
          <div className="device-setup__actions">
            {onDone && (
              <button
                type="button"
                className="device-setup__button device-setup__button--primary tap-feedback"
                onClick={onDone}
              >
                終わる
              </button>
            )}
            <button
              type="button"
              className="device-setup__button device-setup__button--danger tap-feedback"
              onClick={handleClear}
            >
              登録を解除する
            </button>
          </div>
        </section>
      ) : (
        <>
          {/* (A) owner_adminとしてログイン中の場合の登録 */}
          <section className="device-setup__section">
            <h2 className="device-setup__section-title">管理者としてこの端末を登録する</h2>

            <p className="device-setup__note">
              この操作には管理者PIN（数字4桁）の確認が必要です。
              確認してから10分のあいだだけ登録できます。
            </p>

            {!user && (
              <p className="device-setup__note">
                この方法を使うには、ご家族の管理者アカウントでログインしてください。
              </p>
            )}

            {user && membershipsLoading && <p className="device-setup__note">読み込んでいます…</p>}

            {user && !membershipsLoading && ownerAdminMemberships.length === 0 && (
              <p className="device-setup__note">
                管理者（owner_admin）権限のある家族がありません。管理者アカウントでログインし直してください。
              </p>
            )}

            {user && ownerAdminMemberships.length > 0 && (
              <form className="device-setup__form" onSubmit={handleRegister}>
                <label className="device-setup__field">
                  <span className="device-setup__label">どの家族の端末にしますか</span>
                  <select
                    className="device-setup__input"
                    value={effectiveProfileId}
                    onChange={(e) => setSelectedProfileId(e.target.value)}
                    disabled={registering}
                  >
                    {ownerAdminMemberships.map((m) => (
                      <option key={m.profileId} value={m.profileId}>
                        {m.profileName ?? m.profileId}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="device-setup__field">
                  <span className="device-setup__label">端末の名前（任意）</span>
                  <input
                    className="device-setup__input"
                    type="text"
                    value={deviceName}
                    onChange={(e) => setDeviceName(e.target.value)}
                    placeholder="例: ばーばのスマホ"
                    disabled={registering}
                  />
                </label>

                {registerError && (
                  <p className="device-setup__error" role="alert">
                    {registerError}
                  </p>
                )}
                {pinRequired && onNeedPinVerify && (
                  <button
                    type="button"
                    className="device-setup__button device-setup__button--secondary tap-feedback"
                    onClick={onNeedPinVerify}
                  >
                    管理者PINを入力する
                  </button>
                )}
                {registerSuccess && (
                  <p className="device-setup__success" role="status">
                    登録しました
                  </p>
                )}

                <button
                  type="submit"
                  className="device-setup__button device-setup__button--primary tap-feedback"
                  disabled={registering || Boolean(configError)}
                >
                  {registering ? '登録しています…' : 'この端末を本人用として登録する'}
                </button>
              </form>
            )}
          </section>

          {/* (B) 別端末で発行済みのトークンを手入力 */}
          <section className="device-setup__section">
            <h2 className="device-setup__section-title">発行済みのトークンを入力する</h2>
            <p className="device-setup__note">
              別の端末で登録したときに表示されたデバイストークンとプロフィールIDを貼り付けてください。
            </p>

            <form className="device-setup__form" onSubmit={handleManualSave}>
              <label className="device-setup__field">
                <span className="device-setup__label">デバイストークン</span>
                <textarea
                  className="device-setup__input device-setup__input--textarea"
                  value={manualToken}
                  onChange={(e) => setManualToken(e.target.value)}
                  rows={3}
                  autoCapitalize="none"
                  spellCheck={false}
                />
              </label>

              <label className="device-setup__field">
                <span className="device-setup__label">プロフィールID</span>
                <input
                  className="device-setup__input"
                  type="text"
                  value={manualProfileId}
                  onChange={(e) => setManualProfileId(e.target.value)}
                  autoCapitalize="none"
                  spellCheck={false}
                />
              </label>

              {manualError && (
                <p className="device-setup__error" role="alert">
                  {manualError}
                </p>
              )}
              {manualSuccess && (
                <p className="device-setup__success" role="status">
                  保存しました
                </p>
              )}

              <button
                type="submit"
                className="device-setup__button device-setup__button--secondary tap-feedback"
              >
                この端末に保存する
              </button>
            </form>
          </section>
        </>
      )}
    </div>
  )
}
