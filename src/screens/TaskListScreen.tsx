// やること（ToDo）画面。
//
// 未完了のタスクのうち、買い物（category='shopping'）以外を表示する。
// 買い物は「買い物メモ」画面（ShoppingListScreen）で別に扱う。
// 各行の「完了」を押すと完了として記録し、一覧から消す。

import { useCallback, useEffect, useState } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { getDeviceProfileId } from '../lib/deviceToken'
import { completeTask, fetchOpenTasks, formatDueLabel } from '../lib/schedule'
import type { TodoTask } from '../lib/schedule'
import './TaskListScreen.css'

interface TaskListScreenProps {
  /** 「戻る」を押したとき。 */
  onBack: () => void
}

type LoadStatus = 'loading' | 'ready' | 'error'

export function TaskListScreen({ onBack }: TaskListScreenProps) {
  const [tasks, setTasks] = useState<TodoTask[]>([])
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
      setTasks([])
      setStatus('ready')
      return
    }

    let cancelled = false
    setStatus('loading')

    void fetchOpenTasks(profileId)
      .then((rows) => {
        if (cancelled) return
        // 買い物は「買い物メモ」画面の担当のため、ここでは除外する。
        setTasks(rows.filter((task) => task.category !== 'shopping'))
        setStatus('ready')
      })
      .catch((error: unknown) => {
        if (cancelled) return
        console.error('[TaskListScreen] やることを取得できませんでした:', error)
        setTasks([])
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
          setTasks((current) => current.filter((task) => task.id !== taskId))
        })
        .catch((error: unknown) => {
          console.error('[TaskListScreen] 完了にできませんでした:', error)
          setCompleteError('完了にできませんでした。もう一度お試しください')
        })
        .finally(() => setCompletingId(null))
    },
    [completingId, profileId],
  )

  return (
    <div className="task-list">
      <header className="task-list__header">
        <button type="button" className="task-list__back tap-feedback" onClick={onBack}>
          ← 戻る
        </button>
        <h1 className="task-list__title">やること</h1>
      </header>

      <div className="task-list__body">
        {status === 'loading' && <p className="task-list__message">読み込んでいます…</p>}

        {status === 'error' && (
          <div className="task-list__error">
            <p className="task-list__message task-list__message--error">
              やることを読み込めませんでした
            </p>
            <button type="button" className="task-list__retry tap-feedback" onClick={reload}>
              もう一度読み込む
            </button>
          </div>
        )}

        {status === 'ready' && completeError && <p className="task-list__notice">{completeError}</p>}

        {status === 'ready' && tasks.length === 0 && (
          <p className="task-list__message">やることはありません</p>
        )}

        {status === 'ready' && tasks.length > 0 && (
          <ul className="task-list__items">
            {tasks.map((task) => {
              const dueLabel = formatDueLabel(task.dueAt)
              return (
                <li key={task.id} className="task-list__item">
                  <div className="task-list__text">
                    <span className="task-list__name">{task.title}</span>
                    {dueLabel && <span className="task-list__due">{dueLabel}</span>}
                  </div>
                  <button
                    type="button"
                    className="task-list__done tap-feedback"
                    onClick={() => handleComplete(task.id)}
                    disabled={completingId !== null}
                  >
                    {completingId === task.id ? '…' : '完了'}
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
