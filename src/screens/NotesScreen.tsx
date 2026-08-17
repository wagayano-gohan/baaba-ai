// 写真・メモ画面。
//
// ご本人がその場で思いついたことを書き留め、家族が送った写真つきのメモを見るための画面。
// 上部で新しいメモを書き、その下に新しい順のメモが並ぶ。
// 写真は署名URL（有効期限5分）でしか取得できないため、「写真を見る」を押すたびに取り直す。

import { useCallback, useEffect, useRef, useState } from 'react'
import { EmptyGuide } from '../components/EmptyGuide'
import { useAuth } from '../contexts/AuthContext'
import { getDeviceProfileId } from '../lib/deviceToken'
import { addNote, deleteNote, fetchNoteImageUrl, fetchNotes, formatDateTimeLabel } from '../lib/data'
import type { NoteItem } from '../lib/data'
import './NotesScreen.css'

interface NotesScreenProps {
  /** 「戻る」を押したとき。 */
  onBack: () => void
}

type LoadStatus = 'loading' | 'ready' | 'error'

/** 写真オーバーレイの状態。取得中・表示中・失敗の3つだけを持つ。 */
type ImageViewer =
  | { status: 'loading' }
  | { status: 'ready'; url: string }
  | { status: 'error' }

export function NotesScreen({ onBack }: NotesScreenProps) {
  const [notes, setNotes] = useState<NoteItem[]>([])
  const [status, setStatus] = useState<LoadStatus>('loading')

  // 入力欄の内容と保存中フラグ。保存中はボタンを押せなくして二重送信を防ぐ。
  const [draft, setDraft] = useState('')
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  // 削除の確認を表示しているメモのID。window.confirm はPWAで抑止される場合があるため、
  // 確認は画面内の要素で出す。
  const [confirmingId, setConfirmingId] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [deleteError, setDeleteError] = useState<string | null>(null)

  const [viewer, setViewer] = useState<ImageViewer | null>(null)
  // 連続で「写真を見る」を押したとき、古い取得結果が後から届いて新しい表示を
  // 上書きしないよう、最新のリクエストだけを反映する。
  const imageRequestRef = useRef(0)

  // 家族アカウントでログイン中なら選択中のprofile、本人端末（デバイストークン）なら
  // 端末に保存されたprofileを見る。どちらも無い場合は取得しない。
  const { activeProfileId } = useAuth()
  const profileId = activeProfileId ?? getDeviceProfileId()

  const [reloadKey, setReloadKey] = useState(0)
  const reload = useCallback(() => setReloadKey((key) => key + 1), [])

  useEffect(() => {
    if (!profileId) {
      setNotes([])
      setStatus('ready')
      return
    }

    let cancelled = false
    setStatus('loading')

    void fetchNotes(profileId)
      .then((rows) => {
        if (cancelled) return
        setNotes(rows)
        setStatus('ready')
      })
      .catch((error: unknown) => {
        if (cancelled) return
        console.error('[NotesScreen] メモを取得できませんでした:', error)
        setNotes([])
        setStatus('error')
      })

    return () => {
      cancelled = true
    }
  }, [profileId, reloadKey])

  // 前後の空白や改行だけの入力を保存しないよう、送信前に整える。
  const trimmedDraft = draft.trim()

  const handleSave = useCallback(() => {
    if (saving || trimmedDraft === '') return
    setSaving(true)
    setSaveError(null)

    void addNote(profileId, { body: trimmedDraft })
      .then(() => {
        setDraft('')
        // 保存されたメモには作成日時など画面に出す情報が付くため、一覧を取り直す。
        reload()
      })
      .catch((error: unknown) => {
        console.error('[NotesScreen] メモを保存できませんでした:', error)
        setSaveError('保存できませんでした。もう一度お試しください')
      })
      .finally(() => setSaving(false))
  }, [profileId, reload, saving, trimmedDraft])

  const handleShowImage = useCallback(
    (noteId: string) => {
      // 署名URLは5分で失効するため、キャッシュせず開くたびに取得し直す。
      const requestId = imageRequestRef.current + 1
      imageRequestRef.current = requestId
      setViewer({ status: 'loading' })

      void fetchNoteImageUrl(profileId, noteId)
        .then(({ signedUrl }) => {
          if (imageRequestRef.current !== requestId) return
          setViewer({ status: 'ready', url: signedUrl })
        })
        .catch((error: unknown) => {
          if (imageRequestRef.current !== requestId) return
          console.error('[NotesScreen] 写真を取得できませんでした:', error)
          setViewer({ status: 'error' })
        })
    },
    [profileId],
  )

  const handleCloseImage = useCallback(() => {
    // 閉じたあとに古い取得結果でオーバーレイが再表示されないよう、番号を進める。
    imageRequestRef.current += 1
    setViewer(null)
  }, [])

  const handleDelete = useCallback(
    (noteId: string) => {
      if (deletingId) return
      setDeletingId(noteId)
      setDeleteError(null)

      void deleteNote(profileId, noteId)
        .then(() => {
          setNotes((current) => current.filter((note) => note.id !== noteId))
          setConfirmingId(null)
        })
        .catch((error: unknown) => {
          console.error('[NotesScreen] メモを削除できませんでした:', error)
          setDeleteError('削除できませんでした。もう一度お試しください')
        })
        .finally(() => setDeletingId(null))
    },
    [deletingId, profileId],
  )

  return (
    <div className="notes">
      <header className="notes__header">
        <button type="button" className="notes__back tap-feedback" onClick={onBack}>
          ← 戻る
        </button>
        <h1 className="notes__title">写真・メモ</h1>
      </header>

      <div className="notes__body">
        <div className="notes__compose">
          <textarea
            className="notes__input"
            rows={3}
            placeholder="メモを書く"
            aria-label="メモを書く"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
          />
          <button
            type="button"
            className="notes__save tap-feedback"
            onClick={handleSave}
            disabled={saving || trimmedDraft === ''}
          >
            {saving ? '保存しています…' : '保存する'}
          </button>
          {saveError && <p className="notes__notice">{saveError}</p>}
        </div>

        {status === 'loading' && <p className="notes__message">読み込んでいます…</p>}

        {status === 'error' && (
          <div className="notes__error">
            <p className="notes__message notes__message--error">メモを読み込めませんでした</p>
            <button type="button" className="notes__retry tap-feedback" onClick={reload}>
              もう一度読み込む
            </button>
          </div>
        )}

        {status === 'ready' && deleteError && <p className="notes__notice">{deleteError}</p>}

        {status === 'ready' && notes.length === 0 && (
          <EmptyGuide
            title="メモはまだありません"
            examples={['〇〇さんに電話する', '回覧板を隣に回す']}
          />
        )}

        {status === 'ready' && notes.length > 0 && (
          <ul className="notes__items">
            {notes.map((note) => (
              <li key={note.id} className="notes__item">
                <p className="notes__date">{formatDateTimeLabel(note.createdAt)}</p>

                {note.title && <h2 className="notes__item-title">{note.title}</h2>}
                {note.body && <p className="notes__text">{note.body}</p>}

                <div className="notes__actions">
                  {note.hasImage && (
                    <button
                      type="button"
                      className="notes__photo tap-feedback"
                      onClick={() => handleShowImage(note.id)}
                    >
                      写真を見る
                    </button>
                  )}
                  <button
                    type="button"
                    className="notes__delete tap-feedback"
                    onClick={() => {
                      setDeleteError(null)
                      setConfirmingId(note.id)
                    }}
                  >
                    削除
                  </button>
                </div>

                {confirmingId === note.id && (
                  <div className="notes__confirm">
                    <p className="notes__confirm-text">このメモを削除しますか？</p>
                    <div className="notes__confirm-buttons">
                      <button
                        type="button"
                        className="notes__confirm-yes tap-feedback"
                        onClick={() => handleDelete(note.id)}
                        disabled={deletingId !== null}
                      >
                        {deletingId === note.id ? '…' : '削除する'}
                      </button>
                      <button
                        type="button"
                        className="notes__confirm-no tap-feedback"
                        onClick={() => setConfirmingId(null)}
                        disabled={deletingId !== null}
                      >
                        やめる
                      </button>
                    </div>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      {viewer && (
        <div className="notes__overlay">
          <div className="notes__overlay-stage">
            {viewer.status === 'loading' && (
              <p className="notes__overlay-message">読み込んでいます…</p>
            )}
            {viewer.status === 'error' && (
              <p className="notes__overlay-message">写真を表示できませんでした</p>
            )}
            {viewer.status === 'ready' && (
              <img className="notes__overlay-image" src={viewer.url} alt="メモの写真" />
            )}
          </div>
          <button type="button" className="notes__overlay-close tap-feedback" onClick={handleCloseImage}>
            閉じる
          </button>
        </div>
      )}
    </div>
  )
}
