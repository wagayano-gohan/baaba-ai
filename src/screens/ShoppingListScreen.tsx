// 買い物メモ画面。
//
// 未完了のタスクのうち、買い物（category='shopping'）だけを表示する。
// 買い物以外のやることは「やること」画面（TaskListScreen）で扱う。
// 各行の「買った」を押すと完了として記録し、一覧から消す。

import { useCallback, useEffect, useState } from 'react'
import { EmptyGuide } from '../components/EmptyGuide'
import { useAuth } from '../contexts/AuthContext'
import { getDeviceProfileId } from '../lib/deviceToken'
import { completeTask, fetchOpenTasks, formatDueLabel } from '../lib/schedule'
import type { TodoTask } from '../lib/schedule'
import './ShoppingListScreen.css'

interface ShoppingListScreenProps {
  /** 「戻る」を押したとき。 */
  onBack: () => void
  /** 空状態の「話しかける」を押したとき。 */
  onGoVoice: () => void
}

type LoadStatus = 'loading' | 'ready' | 'error'

export function ShoppingListScreen({ onBack, onGoVoice }: ShoppingListScreenProps) {
  const [items, setItems] = useState<TodoTask[]>([])
  const [status, setStatus] = useState<LoadStatus>('loading')
  // 完了処理中のタスクID。二重送信を防ぎ、ボタンを押せない状態にする。
  const [completingId, setCompletingId] = useState<string | null>(null)
  const [completeError, setCompleteError] = useState<string | null>(null)

  // 家族アカウントでログイン中なら選択中のprofile、本人端末（デバイストークン）なら
  // 端末に保存されたprofileを見る。どちらも無い場合は取得しない。
  const { activeProfileId } = useAuth()
  const profileId = activeProfileId ?? getDeviceProfileId()

  const [reloadKey, setReloadKey] = useState(0)
  const reload = useCallback(() => setReloadKey((key) => key + 1), [])

  useEffect(() => {
    if (!profileId) {
      setItems([])
      setStatus('ready')
      return
    }

    let cancelled = false
    setStatus('loading')

    void fetchOpenTasks(profileId)
      .then((rows) => {
        if (cancelled) return
        setItems(rows.filter((task) => task.category === 'shopping'))
        setStatus('ready')
      })
      .catch((error: unknown) => {
        if (cancelled) return
        console.error('[ShoppingListScreen] 買い物メモを取得できませんでした:', error)
        setItems([])
        setStatus('error')
      })

    return () => {
      cancelled = true
    }
  }, [profileId, reloadKey])

  const handleComplete = useCallback(
    (taskId: string) => {
      if (completingId) return
      setCompletingId(taskId)
      setCompleteError(null)

      void completeTask(profileId, taskId)
        .then(() => {
          setItems((current) => current.filter((task) => task.id !== taskId))
        })
        .catch((error: unknown) => {
          console.error('[ShoppingListScreen] 完了にできませんでした:', error)
          setCompleteError('記録できませんでした。もう一度お試しください')
        })
        .finally(() => setCompletingId(null))
    },
    [completingId, profileId],
  )

  return (
    <div className="shopping-list">
      <header className="shopping-list__header">
        <button type="button" className="shopping-list__back tap-feedback" onClick={onBack}>
          ← 戻る
        </button>
        <h1 className="shopping-list__title">買い物メモ</h1>
      </header>

      <div className="shopping-list__body">
        {status === 'loading' && <p className="shopping-list__message">読み込んでいます…</p>}

        {status === 'error' && (
          <div className="shopping-list__error">
            <p className="shopping-list__message shopping-list__message--error">
              買い物メモを読み込めませんでした
            </p>
            <button type="button" className="shopping-list__retry tap-feedback" onClick={reload}>
              もう一度読み込む
            </button>
          </div>
        )}

        {status === 'ready' && completeError && (
          <p className="shopping-list__notice">{completeError}</p>
        )}

        {status === 'ready' && items.length === 0 && (
          <EmptyGuide
            title="買うものはありません"
            examples={['牛乳買っといて', '卵と食パンを買う']}
            onAction={onGoVoice}
          />
        )}

        {status === 'ready' && items.length > 0 && (
          <ul className="shopping-list__items">
            {items.map((item) => {
              const dueLabel = formatDueLabel(item.dueAt)
              return (
                <li key={item.id} className="shopping-list__item">
                  <div className="shopping-list__text">
                    <span className="shopping-list__name">{item.title}</span>
                    {dueLabel && <span className="shopping-list__due">{dueLabel}</span>}
                  </div>
                  <button
                    type="button"
                    className="shopping-list__done tap-feedback"
                    onClick={() => handleComplete(item.id)}
                    disabled={completingId !== null}
                  >
                    {completingId === item.id ? '…' : '買った'}
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </div>
  )
}
