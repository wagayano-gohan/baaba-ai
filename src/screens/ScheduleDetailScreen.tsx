import { useState } from 'react'
import { ChevronLeftIcon } from '../components/icons'
import type { Appointment } from '../lib/appointments'
import { softDeleteAppointment } from '../lib/appointments'
import { toDateLabel, toTimeLabel } from '../utils/date'
import './ScheduleDetailScreen.css'

interface ScheduleDetailScreenProps {
  appointment: Appointment
  onBack: () => void
  onEdit: (appointment: Appointment) => void
  onDeleted: () => void
}

// 予定詳細画面（一覧からのタップで表示）。「へんこう」「けす」の操作口。
export function ScheduleDetailScreen({ appointment, onBack, onEdit, onDeleted }: ScheduleDetailScreenProps) {
  const [status, setStatus] = useState<'idle' | 'deleting' | 'error'>('idle')
  const [errorMessage, setErrorMessage] = useState('')

  const d = new Date(appointment.scheduled_at)

  const handleDelete = async () => {
    if (!window.confirm('本当に けしますか？')) return
    setStatus('deleting')
    try {
      await softDeleteAppointment(appointment.id)
      onDeleted()
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : String(error))
      setStatus('error')
    }
  }

  return (
    <div className="schedule-detail-screen">
      <button type="button" className="schedule-detail-screen__back tap-feedback" onClick={onBack}>
        <ChevronLeftIcon size={20} />
        もどる
      </button>

      <h1 className="schedule-detail-screen__heading">よていの詳細</h1>

      <section className="schedule-detail-card" aria-label="よていの内容">
        <p className="schedule-detail-card__date">{toDateLabel(d)}</p>
        <p className="schedule-detail-card__time">{toTimeLabel(d)}</p>
        <p className="schedule-detail-card__title">{appointment.title}</p>
        {appointment.location && <p className="schedule-detail-card__meta">{appointment.location}</p>}
        {appointment.departure_note && <p className="schedule-detail-card__meta">{appointment.departure_note}</p>}
      </section>

      {status === 'error' && <p className="schedule-detail-screen__error">エラー: {errorMessage}</p>}

      <div className="schedule-detail-screen__actions">
        <button
          type="button"
          className="schedule-detail-screen__button schedule-detail-screen__button--edit tap-feedback"
          onClick={() => onEdit(appointment)}
          disabled={status === 'deleting'}
        >
          へんこう
        </button>
        <button
          type="button"
          className="schedule-detail-screen__button schedule-detail-screen__button--delete tap-feedback"
          onClick={handleDelete}
          disabled={status === 'deleting'}
        >
          {status === 'deleting' ? 'けしています…' : 'けす'}
        </button>
      </div>
    </div>
  )
}
