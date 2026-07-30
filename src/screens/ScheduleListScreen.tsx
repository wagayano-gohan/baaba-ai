import { useState } from 'react'
import { BottomNav } from '../components/BottomNav'
import type { ScheduleItem } from '../data/schedules'
import './ScheduleListScreen.css'

interface ScheduleListScreenProps {
  schedules: ScheduleItem[]
  onNavigateHome: () => void
  onEdit: (item: ScheduleItem) => void
  onDelete: (id: number) => void
}

// 仕様書 10章: ④予定一覧画面
export function ScheduleListScreen({
  schedules,
  onNavigateHome,
  onEdit,
  onDelete,
}: ScheduleListScreenProps) {
  const [deleteTargetId, setDeleteTargetId] = useState<number | null>(null)

  const handleConfirmDelete = () => {
    if (deleteTargetId !== null) {
      onDelete(deleteTargetId)
    }
    setDeleteTargetId(null)
  }

  return (
    <div className="schedule-list-screen">
      <div className="schedule-list-screen__scroll">
        <h1 className="schedule-list-screen__heading">よてい</h1>

        {schedules.length === 0 ? (
          <p className="schedule-list-screen__empty">よていは ありません</p>
        ) : (
          <ul className="schedule-list">
            {schedules.map((item) => (
              <li key={item.id} className="schedule-card">
                <p className="schedule-card__date">{item.dateLabel}</p>
                <p className="schedule-card__time">{item.timeLabel}</p>
                <p className="schedule-card__content">{item.content}</p>
                <div className="schedule-card__actions">
                  <button
                    type="button"
                    className="schedule-card__button schedule-card__button--edit tap-feedback"
                    onClick={() => onEdit(item)}
                  >
                    へんこう
                  </button>
                  <button
                    type="button"
                    className="schedule-card__button schedule-card__button--delete tap-feedback"
                    onClick={() => setDeleteTargetId(item.id)}
                  >
                    けす
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      <BottomNav active="list" onNavigateHome={onNavigateHome} onNavigateList={() => {}} />

      {deleteTargetId !== null && (
        <div className="delete-dialog-overlay" role="alertdialog" aria-modal="true">
          <div className="delete-dialog">
            <p className="delete-dialog__heading">本当に けしますか？</p>
            <div className="delete-dialog__actions">
              <button
                type="button"
                className="delete-dialog__button delete-dialog__button--confirm tap-feedback"
                onClick={handleConfirmDelete}
              >
                けす
              </button>
              <button
                type="button"
                className="delete-dialog__button delete-dialog__button--cancel tap-feedback"
                onClick={() => setDeleteTargetId(null)}
              >
                やめる
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
