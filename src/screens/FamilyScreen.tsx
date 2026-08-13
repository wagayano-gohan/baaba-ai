// ご家族（管理者）が、ご本人の情報をまとめて登録・管理する画面。
//
// 本人向け画面が「見る・押すだけ」なのに対し、この画面は入力の要になる。
// 扱う項目が7種類と多いため、すべてを縦に並べると画面が非常に長くなる。
// そこでアコーディオン（開閉式セクション）にし、一度に1つだけ開く方式とした。
// 見出しに登録件数を添えることで、開かなくても登録状況が把握できるようにしている。
//
// この画面は家族アカウント専用のため、profileIdはログイン中に選択している家族のものを使い、
// 本人端末のデバイストークン（getDeviceProfileId）は参照しない。

import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { useAuth } from '../contexts/AuthContext'
import {
  addContact,
  addDelivery,
  addEvent,
  addLocation,
  addMedication,
  addTask,
  deleteContact,
  deleteDelivery,
  deleteEvent,
  deleteLocation,
  deleteMedication,
  deleteTask,
  fetchContacts,
  fetchDeliveries,
  fetchEvents,
  fetchLocations,
  fetchMedications,
  fetchSettings,
  fetchTasks,
  formatDateTimeLabel,
  geocodePlace,
  jstInputToUtcIso,
  saveSettings,
  weekdayKanji,
} from '../lib/data'
import type {
  ContactItem,
  DeliveryItem,
  EventItem,
  GarbageSchedule,
  GeocodeResult,
  LocationItem,
  MedicationItem,
  TaskItem,
} from '../lib/data'
import './FamilyScreen.css'

interface FamilyScreenProps {
  /** 「戻る」を押したとき。 */
  onBack: () => void
}

type LoadStatus = 'loading' | 'ready' | 'error'

type SectionKey =
  | 'events'
  | 'tasks'
  | 'medications'
  | 'deliveries'
  | 'contacts'
  | 'locations'
  | 'garbage'

/** 場所の種類コードと、画面に出す日本語表記の対応。 */
const LOCATION_CATEGORY_LABELS: Record<string, string> = {
  home: '自宅',
  hospital: '病院',
  store: 'お店',
  family: '家族の家',
  other: 'その他',
}

const LOCATION_CATEGORY_OPTIONS = ['home', 'hospital', 'store', 'family', 'other']

/** 服薬時刻の選択肢。時刻はサーバー側の予定生成にそのまま渡す。 */
const MEDICATION_TIME_OPTIONS = [
  { value: '08:00', label: '朝 8:00' },
  { value: '12:00', label: '昼 12:00' },
  { value: '18:00', label: '夕 18:00' },
  { value: '21:00', label: '寝る前 21:00' },
]

const MEDICATION_DAY_OPTIONS = [7, 14, 30, 60, 90]

const WEEKDAY_KEYS = ['0', '1', '2', '3', '4', '5', '6']

/** 空文字・null・undefinedを画面にそのまま出さないための置き換え。 */
function textOr(value: string | null | undefined, fallback: string): string {
  const trimmed = (value ?? '').trim()
  return trimmed === '' ? fallback : trimmed
}

/** 入力欄の値を、保存用に「空ならnull」へ正規化する。 */
function trimmedOrNull(value: string): string | null {
  const trimmed = value.trim()
  return trimmed === '' ? null : trimmed
}

interface FamilySectionProps {
  title: string
  /** 見出しに添える件数表記（例「2件」）。 */
  count: string
  open: boolean
  onToggle: () => void
  children: ReactNode
}

/** 開閉できるセクションの外枠。開いているものだけ中身を描画する。 */
function FamilySection({ title, count, open, onToggle, children }: FamilySectionProps) {
  return (
    <section className="family__section">
      <h2 className="family__section-heading">
        <button
          type="button"
          className="family__section-toggle tap-feedback"
          onClick={onToggle}
          aria-expanded={open}
        >
          <span className="family__section-name">
            {title}（{count}）
          </span>
          <span className="family__section-mark">{open ? '閉じる' : '開く'}</span>
        </button>
      </h2>
      {open && <div className="family__section-body">{children}</div>}
    </section>
  )
}

interface DeleteControlProps {
  /** この行が確認待ちかどうか。 */
  confirming: boolean
  /** 通信中はすべての操作ボタンを押せなくする。 */
  busy: boolean
  onAsk: () => void
  onCancel: () => void
  onConfirm: () => void
  askLabel?: string
  question?: string
  confirmLabel?: string
}

/**
 * 削除ボタンと、その場に出る確認表示。
 * window.confirmはブラウザ標準の小さな文字で表示され読みづらいため、画面内の要素で確認する。
 */
function DeleteControl({
  confirming,
  busy,
  onAsk,
  onCancel,
  onConfirm,
  askLabel = '削除',
  question = '削除しますか？',
  confirmLabel = '削除する',
}: DeleteControlProps) {
  if (!confirming) {
    return (
      <button type="button" className="family__delete tap-feedback" onClick={onAsk} disabled={busy}>
        {askLabel}
      </button>
    )
  }
  return (
    <div className="family__confirm">
      <span className="family__confirm-text">{question}</span>
      <div className="family__confirm-buttons">
        <button
          type="button"
          className="family__confirm-yes tap-feedback"
          onClick={onConfirm}
          disabled={busy}
        >
          {confirmLabel}
        </button>
        <button
          type="button"
          className="family__confirm-no tap-feedback"
          onClick={onCancel}
          disabled={busy}
        >
          やめる
        </button>
      </div>
    </div>
  )
}

export function FamilyScreen({ onBack }: FamilyScreenProps) {
  // この画面は家族アカウント専用のため、選択中の家族のprofileIdだけを見る。
  const { activeProfileId, activeRole } = useAuth()
  const profileId = activeProfileId

  // owner_admin以外は登録・削除ができない。一覧の閲覧だけを許可する。
  const canEdit = activeRole === 'owner_admin'

  const [status, setStatus] = useState<LoadStatus>('loading')
  const [reloadKey, setReloadKey] = useState(0)
  const reload = useCallback(() => setReloadKey((key) => key + 1), [])

  const [events, setEvents] = useState<EventItem[]>([])
  const [tasks, setTasks] = useState<TaskItem[]>([])
  const [medications, setMedications] = useState<MedicationItem[]>([])
  const [deliveries, setDeliveries] = useState<DeliveryItem[]>([])
  const [contacts, setContacts] = useState<ContactItem[]>([])
  const [locations, setLocations] = useState<LocationItem[]>([])
  const [garbage, setGarbage] = useState<GarbageSchedule>({})

  // 一度に1つだけ開く。初期状態はすべて閉じ、まず全体像が見えるようにする。
  const [openSection, setOpenSection] = useState<SectionKey | null>(null)
  const toggleSection = useCallback((key: SectionKey) => {
    setOpenSection((current) => (current === key ? null : key))
  }, [])

  // 通信中のセクション。押している間は同じ画面内のボタンを押せなくして二重送信を防ぐ。
  const [busySection, setBusySection] = useState<SectionKey | null>(null)
  // セクションごとの失敗表示。画面全体をエラーにせず、その場だけに出す。
  const [sectionError, setSectionError] = useState<Partial<Record<SectionKey, string>>>({})
  // 削除の確認待ち対象（セクションと行の識別子）。
  const [deleteTarget, setDeleteTarget] = useState<{ section: SectionKey; id: string } | null>(null)

  // --- 各セクションの入力欄 ---------------------------------------------
  const [eventTitle, setEventTitle] = useState('')
  const [eventDate, setEventDate] = useState('')
  const [eventTime, setEventTime] = useState('')
  const [eventPlace, setEventPlace] = useState('')

  const [taskTitle, setTaskTitle] = useState('')
  const [taskCategory, setTaskCategory] = useState('other')
  const [taskDueDate, setTaskDueDate] = useState('')

  const [medName, setMedName] = useState('')
  const [medDosage, setMedDosage] = useState('')
  const [medTimes, setMedTimes] = useState<string[]>([])
  const [medDays, setMedDays] = useState(30)

  const [deliveryName, setDeliveryName] = useState('')
  const [deliveryCarrier, setDeliveryCarrier] = useState('')
  const [deliveryDate, setDeliveryDate] = useState('')
  const [deliveryTime, setDeliveryTime] = useState('')
  const [deliveryMemo, setDeliveryMemo] = useState('')

  const [contactName, setContactName] = useState('')
  const [contactRelationship, setContactRelationship] = useState('')
  const [contactPhone, setContactPhone] = useState('')
  const [contactFavorite, setContactFavorite] = useState(false)

  const [locationName, setLocationName] = useState('')
  const [locationCategory, setLocationCategory] = useState('other')
  const [locationQuery, setLocationQuery] = useState('')
  const [geoResults, setGeoResults] = useState<GeocodeResult[]>([])
  const [geoSelected, setGeoSelected] = useState<GeocodeResult | null>(null)
  const [geoStatus, setGeoStatus] = useState<'idle' | 'searching' | 'done' | 'empty' | 'error'>(
    'idle',
  )

  const [garbageSaved, setGarbageSaved] = useState(false)

  // 「保存しました」は数秒で自然に消えるようにする（消し忘れの誤解を避けるため）。
  useEffect(() => {
    if (!garbageSaved) return
    const timer = window.setTimeout(() => setGarbageSaved(false), 3000)
    return () => window.clearTimeout(timer)
  }, [garbageSaved])

  // --- 初期読み込み -------------------------------------------------------
  useEffect(() => {
    if (!profileId) {
      setStatus('ready')
      return
    }

    let cancelled = false
    setStatus('loading')

    void Promise.all([
      fetchEvents(profileId),
      fetchTasks(profileId),
      fetchMedications(profileId),
      fetchDeliveries(profileId),
      fetchContacts(profileId),
      fetchLocations(profileId),
      fetchSettings(profileId),
    ])
      .then(([eventRows, taskRows, medRows, deliveryRows, contactRows, locationRows, settings]) => {
        if (cancelled) return
        setEvents(eventRows)
        setTasks(taskRows)
        setMedications(medRows)
        setDeliveries(deliveryRows)
        setContacts(contactRows)
        setLocations(locationRows)
        setGarbage(settings.settings.garbage ?? {})
        setStatus('ready')
      })
      .catch((error: unknown) => {
        if (cancelled) return
        console.error('[FamilyScreen] 登録情報を取得できませんでした:', error)
        setStatus('error')
      })

    return () => {
      cancelled = true
    }
  }, [profileId, reloadKey])

  // --- 共通の更新処理 -----------------------------------------------------
  /**
   * 追加・削除の共通処理。
   * 実行中はセクション単位でボタンを止め、失敗してもそのセクション内にだけ文言を出す。
   */
  const runAction = useCallback(
    (section: SectionKey, failureMessage: string, action: () => Promise<void>) => {
      if (busySection) return
      setBusySection(section)
      setSectionError((current) => ({ ...current, [section]: undefined }))

      void action()
        .catch((error: unknown) => {
          console.error(`[FamilyScreen] ${section} の操作に失敗しました:`, error)
          setSectionError((current) => ({ ...current, [section]: failureMessage }))
        })
        .finally(() => setBusySection(null))
    },
    [busySection],
  )

  const setError = useCallback((section: SectionKey, message: string) => {
    setSectionError((current) => ({ ...current, [section]: message }))
  }, [])

  // --- 1. 予定 -----------------------------------------------------------
  const handleAddEvent = useCallback(() => {
    const title = eventTitle.trim()
    if (title === '' || eventDate === '') {
      setError('events', '予定の内容と日付を入力してください')
      return
    }
    runAction('events', '登録できませんでした。もう一度お試しください', async () => {
      // 時刻が空のときは00:00で保存され、表示側で「時刻未定」として扱われる。
      await addEvent(profileId, {
        title,
        startsAt: jstInputToUtcIso(eventDate, eventTime === '' ? null : eventTime),
        locationText: trimmedOrNull(eventPlace),
      })
      setEvents(await fetchEvents(profileId))
      setEventTitle('')
      setEventDate('')
      setEventTime('')
      setEventPlace('')
    })
  }, [eventDate, eventPlace, eventTime, eventTitle, profileId, runAction, setError])

  const handleDeleteEvent = useCallback(
    (eventId: string) => {
      runAction('events', '削除できませんでした。もう一度お試しください', async () => {
        await deleteEvent(profileId, eventId)
        setEvents((current) => current.filter((item) => item.id !== eventId))
        setDeleteTarget(null)
      })
    },
    [profileId, runAction],
  )

  // --- 2. やること・買い物 ------------------------------------------------
  const handleAddTask = useCallback(() => {
    const title = taskTitle.trim()
    if (title === '') {
      setError('tasks', '内容を入力してください')
      return
    }
    runAction('tasks', '登録できませんでした。もう一度お試しください', async () => {
      await addTask(profileId, {
        title,
        category: taskCategory,
        // 期限は日付のみを扱うため、時刻は渡さない。
        dueAt: taskDueDate === '' ? null : jstInputToUtcIso(taskDueDate, null),
      })
      setTasks(await fetchTasks(profileId))
      setTaskTitle('')
      setTaskCategory('other')
      setTaskDueDate('')
    })
  }, [profileId, runAction, setError, taskCategory, taskDueDate, taskTitle])

  const handleDeleteTask = useCallback(
    (taskId: string) => {
      runAction('tasks', '削除できませんでした。もう一度お試しください', async () => {
        await deleteTask(profileId, taskId)
        setTasks((current) => current.filter((item) => item.id !== taskId))
        setDeleteTarget(null)
      })
    },
    [profileId, runAction],
  )

  // --- 3. お薬 -----------------------------------------------------------
  // fetchMedicationsは1回の服薬ごとに1行返るため、薬の名前ごとにまとめて表示する。
  const medicationGroups = useMemo(() => {
    const groups = new Map<string, { name: string; dosage: string | null; upcoming: number }>()
    for (const row of medications) {
      const name = textOr(row.medicationName, '名前のないお薬')
      const group = groups.get(name) ?? { name, dosage: null, upcoming: 0 }
      if (group.dosage === null && row.dosage) group.dosage = row.dosage
      if (row.status === 'scheduled') group.upcoming += 1
      groups.set(name, group)
    }
    return [...groups.values()]
  }, [medications])

  const toggleMedTime = useCallback((time: string) => {
    setMedTimes((current) =>
      current.includes(time) ? current.filter((item) => item !== time) : [...current, time],
    )
  }, [])

  const handleAddMedication = useCallback(() => {
    const medicationName = medName.trim()
    if (medicationName === '') {
      setError('medications', 'お薬の名前を入力してください')
      return
    }
    if (medTimes.length === 0) {
      setError('medications', '飲む時間を1つ以上選んでください')
      return
    }
    runAction('medications', '登録できませんでした。もう一度お試しください', async () => {
      await addMedication(profileId, {
        medicationName,
        dosage: trimmedOrNull(medDosage),
        // 表示順が入力順に左右されないよう、時刻を昇順に整えてから保存する。
        times: [...medTimes].sort(),
        days: medDays,
      })
      setMedications(await fetchMedications(profileId))
      setMedName('')
      setMedDosage('')
      setMedTimes([])
      setMedDays(30)
    })
  }, [medDays, medDosage, medName, medTimes, profileId, runAction, setError])

  const handleDeleteMedication = useCallback(
    (medicationName: string) => {
      runAction('medications', '取り消せませんでした。もう一度お試しください', async () => {
        await deleteMedication(profileId, medicationName)
        setMedications(await fetchMedications(profileId))
        setDeleteTarget(null)
      })
    },
    [profileId, runAction],
  )

  // --- 4. 荷物の受け取り予定 ---------------------------------------------
  const handleAddDelivery = useCallback(() => {
    const itemName = deliveryName.trim()
    if (itemName === '') {
      setError('deliveries', '荷物の名前を入力してください')
      return
    }
    runAction('deliveries', '登録できませんでした。もう一度お試しください', async () => {
      await addDelivery(profileId, {
        itemName,
        carrier: trimmedOrNull(deliveryCarrier),
        expectedAt:
          deliveryDate === ''
            ? null
            : jstInputToUtcIso(deliveryDate, deliveryTime === '' ? null : deliveryTime),
        memo: trimmedOrNull(deliveryMemo),
      })
      setDeliveries(await fetchDeliveries(profileId))
      setDeliveryName('')
      setDeliveryCarrier('')
      setDeliveryDate('')
      setDeliveryTime('')
      setDeliveryMemo('')
    })
  }, [
    deliveryCarrier,
    deliveryDate,
    deliveryMemo,
    deliveryName,
    deliveryTime,
    profileId,
    runAction,
    setError,
  ])

  const handleDeleteDelivery = useCallback(
    (deliveryId: string) => {
      runAction('deliveries', '削除できませんでした。もう一度お試しください', async () => {
        await deleteDelivery(profileId, deliveryId)
        setDeliveries((current) => current.filter((item) => item.id !== deliveryId))
        setDeleteTarget(null)
      })
    },
    [profileId, runAction],
  )

  // --- 5. 連絡先 ---------------------------------------------------------
  const handleAddContact = useCallback(() => {
    const name = contactName.trim()
    if (name === '') {
      setError('contacts', '名前を入力してください')
      return
    }
    runAction('contacts', '登録できませんでした。もう一度お試しください', async () => {
      await addContact(profileId, {
        name,
        relationship: trimmedOrNull(contactRelationship),
        phoneNumber: trimmedOrNull(contactPhone),
        isFavorite: contactFavorite,
      })
      setContacts(await fetchContacts(profileId))
      setContactName('')
      setContactRelationship('')
      setContactPhone('')
      setContactFavorite(false)
    })
  }, [
    contactFavorite,
    contactName,
    contactPhone,
    contactRelationship,
    profileId,
    runAction,
    setError,
  ])

  const handleDeleteContact = useCallback(
    (contactId: string) => {
      runAction('contacts', '削除できませんでした。もう一度お試しください', async () => {
        await deleteContact(profileId, contactId)
        setContacts((current) => current.filter((item) => item.id !== contactId))
        setDeleteTarget(null)
      })
    },
    [profileId, runAction],
  )

  // --- 6. よく行く場所 ---------------------------------------------------
  const handleGeocode = useCallback(() => {
    const query = locationQuery.trim()
    if (query === '') {
      setError('locations', '地名または住所を入力してください')
      return
    }
    setGeoStatus('searching')
    setGeoResults([])
    setGeoSelected(null)

    void geocodePlace(query)
      .then((results) => {
        setGeoResults(results)
        setGeoStatus(results.length === 0 ? 'empty' : 'done')
      })
      .catch((error: unknown) => {
        console.error('[FamilyScreen] 地名を調べられませんでした:', error)
        setGeoStatus('error')
      })
  }, [locationQuery, setError])

  const handleAddLocation = useCallback(() => {
    const name = locationName.trim()
    if (name === '') {
      setError('locations', '場所の名前を入力してください')
      return
    }
    runAction('locations', '登録できませんでした。もう一度お試しください', async () => {
      // 緯度経度が未確定でも保存する。その場合は住所の文字列で地図を開く。
      await addLocation(profileId, {
        name,
        category: locationCategory,
        address: trimmedOrNull(locationQuery),
        latitude: geoSelected ? geoSelected.latitude : null,
        longitude: geoSelected ? geoSelected.longitude : null,
      })
      setLocations(await fetchLocations(profileId))
      setLocationName('')
      setLocationCategory('other')
      setLocationQuery('')
      setGeoResults([])
      setGeoSelected(null)
      setGeoStatus('idle')
    })
  }, [
    geoSelected,
    locationCategory,
    locationName,
    locationQuery,
    profileId,
    runAction,
    setError,
  ])

  const handleDeleteLocation = useCallback(
    (locationId: string) => {
      runAction('locations', '削除できませんでした。もう一度お試しください', async () => {
        await deleteLocation(profileId, locationId)
        setLocations((current) => current.filter((item) => item.id !== locationId))
        setDeleteTarget(null)
      })
    },
    [profileId, runAction],
  )

  // --- 7. ゴミの日 -------------------------------------------------------
  const garbageDayCount = WEEKDAY_KEYS.filter((key) => (garbage[key] ?? '').trim() !== '').length

  const handleGarbageChange = useCallback((weekday: string, value: string) => {
    setGarbage((current) => ({ ...current, [weekday]: value }))
  }, [])

  const handleSaveGarbage = useCallback(() => {
    runAction('garbage', '保存できませんでした。もう一度お試しください', async () => {
      // 空欄は「収集なし」を意味するため、キー自体を含めずに送る。
      const payload: GarbageSchedule = {}
      for (const key of WEEKDAY_KEYS) {
        const value = (garbage[key] ?? '').trim()
        if (value !== '') payload[key] = value
      }
      await saveSettings(profileId, payload)
      setGarbage(payload)
      setGarbageSaved(true)
    })
  }, [garbage, profileId, runAction])

  // --- 表示 ---------------------------------------------------------------
  const isConfirming = (section: SectionKey, id: string) =>
    deleteTarget !== null && deleteTarget.section === section && deleteTarget.id === id

  const askDelete = (section: SectionKey, id: string) => setDeleteTarget({ section, id })
  const cancelDelete = () => setDeleteTarget(null)

  const renderError = (section: SectionKey) => {
    const message = sectionError[section]
    if (!message) return null
    return <p className="family__notice">{message}</p>
  }

  return (
    <div className="family">
      <header className="family__header">
        <button type="button" className="family__back tap-feedback" onClick={onBack}>
          ← 戻る
        </button>
        <h1 className="family__title">ご家族の見守り画面</h1>
      </header>

      <div className="family__body">
        {/*
          この画面は「ご家族が全部入力する管理画面」ではない。
          予定・やること・買い物・お薬の服用記録・荷物は、ご本人が話しかけるだけで登録できる。
          ここは、その内容の確認・修正と、必要なときの代理入力・見守りのために使う。
        */}
        <p className="family__permission">
          日々の予定・やること・買い物・お薬を飲んだ記録・荷物の受け取りは、ご本人が「話しかける」だけで登録できます。
          この画面は、ご本人が登録した内容の確認・修正と、必要なときの代理入力・見守りのためにお使いください。
        </p>

        {status === 'loading' && <p className="family__message">読み込んでいます…</p>}

        {status === 'error' && (
          <div className="family__error">
            <p className="family__message family__message--error">登録情報を読み込めませんでした</p>
            <button type="button" className="family__retry tap-feedback" onClick={reload}>
              もう一度読み込む
            </button>
          </div>
        )}

        {status === 'ready' && !profileId && (
          <p className="family__message">対象のご家族が選択されていません</p>
        )}

        {status === 'ready' && profileId && (
          <>
            {!canEdit && <p className="family__permission">この操作には管理者の権限が必要です</p>}

            {/* 1. 予定 */}
            <FamilySection
              title="予定"
              count={`${events.length}件`}
              open={openSection === 'events'}
              onToggle={() => toggleSection('events')}
            >
              {renderError('events')}

              {events.length === 0 ? (
                <p className="family__empty">登録された予定はありません</p>
              ) : (
                <ul className="family__list">
                  {events.map((item) => (
                    <li key={item.id} className="family__item">
                      <div className="family__item-text">
                        <span className="family__item-name">{textOr(item.title, '内容未設定')}</span>
                        <span className="family__item-sub">
                          {textOr(formatDateTimeLabel(item.startsAt), '日時未設定')}
                          {item.locationText ? `／${item.locationText}` : ''}
                        </span>
                      </div>
                      {canEdit && (
                        <DeleteControl
                          confirming={isConfirming('events', item.id)}
                          busy={busySection !== null}
                          onAsk={() => askDelete('events', item.id)}
                          onCancel={cancelDelete}
                          onConfirm={() => handleDeleteEvent(item.id)}
                        />
                      )}
                    </li>
                  ))}
                </ul>
              )}

              {canEdit && (
                <div className="family__form">
                  <h3 className="family__form-title">予定を追加する</h3>

                  <label className="family__field">
                    <span className="family__label">予定の内容（必須）</span>
                    <input
                      type="text"
                      className="family__input"
                      value={eventTitle}
                      onChange={(e) => setEventTitle(e.target.value)}
                      disabled={busySection !== null}
                    />
                  </label>

                  <div className="family__field-row">
                    <label className="family__field">
                      <span className="family__label">日付（必須）</span>
                      <input
                        type="date"
                        className="family__input"
                        value={eventDate}
                        onChange={(e) => setEventDate(e.target.value)}
                        disabled={busySection !== null}
                      />
                    </label>
                    <label className="family__field">
                      <span className="family__label">時刻</span>
                      <input
                        type="time"
                        className="family__input"
                        value={eventTime}
                        onChange={(e) => setEventTime(e.target.value)}
                        disabled={busySection !== null}
                      />
                    </label>
                  </div>

                  <label className="family__field">
                    <span className="family__label">場所</span>
                    <input
                      type="text"
                      className="family__input"
                      value={eventPlace}
                      onChange={(e) => setEventPlace(e.target.value)}
                      disabled={busySection !== null}
                    />
                  </label>

                  <button
                    type="button"
                    className="family__submit tap-feedback"
                    onClick={handleAddEvent}
                    disabled={busySection !== null}
                  >
                    {busySection === 'events' ? '登録しています…' : '予定を登録する'}
                  </button>
                </div>
              )}
            </FamilySection>

            {/* 2. やること・買い物 */}
            <FamilySection
              title="やること・買い物"
              count={`${tasks.length}件`}
              open={openSection === 'tasks'}
              onToggle={() => toggleSection('tasks')}
            >
              {renderError('tasks')}

              {tasks.length === 0 ? (
                <p className="family__empty">登録されたやること・買い物はありません</p>
              ) : (
                <ul className="family__list">
                  {tasks.map((item) => {
                    const dueLabel = formatDateTimeLabel(item.dueAt)
                    return (
                      <li key={item.id} className="family__item">
                        <div className="family__item-text">
                          <span className="family__item-name">
                            {textOr(item.title, '内容未設定')}
                          </span>
                          <span className="family__item-sub">
                            {item.category === 'shopping' ? '買い物' : 'やること'}
                            {dueLabel === '' ? '' : `／期限 ${dueLabel}`}
                          </span>
                        </div>
                        {canEdit && (
                          <DeleteControl
                            confirming={isConfirming('tasks', item.id)}
                            busy={busySection !== null}
                            onAsk={() => askDelete('tasks', item.id)}
                            onCancel={cancelDelete}
                            onConfirm={() => handleDeleteTask(item.id)}
                          />
                        )}
                      </li>
                    )
                  })}
                </ul>
              )}

              {canEdit && (
                <div className="family__form">
                  <h3 className="family__form-title">やること・買い物を追加する</h3>

                  <label className="family__field">
                    <span className="family__label">内容（必須）</span>
                    <input
                      type="text"
                      className="family__input"
                      value={taskTitle}
                      onChange={(e) => setTaskTitle(e.target.value)}
                      disabled={busySection !== null}
                    />
                  </label>

                  <div className="family__field-row">
                    <label className="family__field">
                      <span className="family__label">種別</span>
                      <select
                        className="family__input"
                        value={taskCategory}
                        onChange={(e) => setTaskCategory(e.target.value)}
                        disabled={busySection !== null}
                      >
                        <option value="other">やること</option>
                        <option value="shopping">買い物</option>
                      </select>
                    </label>
                    <label className="family__field">
                      <span className="family__label">期限日</span>
                      <input
                        type="date"
                        className="family__input"
                        value={taskDueDate}
                        onChange={(e) => setTaskDueDate(e.target.value)}
                        disabled={busySection !== null}
                      />
                    </label>
                  </div>

                  <button
                    type="button"
                    className="family__submit tap-feedback"
                    onClick={handleAddTask}
                    disabled={busySection !== null}
                  >
                    {busySection === 'tasks' ? '登録しています…' : '登録する'}
                  </button>
                </div>
              )}
            </FamilySection>

            {/* 3. お薬 */}
            <FamilySection
              title="お薬"
              count={`${medicationGroups.length}件`}
              open={openSection === 'medications'}
              onToggle={() => toggleSection('medications')}
            >
              {renderError('medications')}

              {medicationGroups.length === 0 ? (
                <p className="family__empty">登録されたお薬はありません</p>
              ) : (
                <ul className="family__list">
                  {medicationGroups.map((group) => (
                    <li key={group.name} className="family__item">
                      <div className="family__item-text">
                        <span className="family__item-name">{group.name}</span>
                        <span className="family__item-sub">
                          {textOr(group.dosage, '分量の登録なし')}／これから飲む予定 {group.upcoming}
                          回
                        </span>
                      </div>
                      {canEdit && (
                        <DeleteControl
                          confirming={isConfirming('medications', group.name)}
                          busy={busySection !== null}
                          onAsk={() => askDelete('medications', group.name)}
                          onCancel={cancelDelete}
                          onConfirm={() => handleDeleteMedication(group.name)}
                          askLabel="登録を取り消す"
                          question="これから飲む予定を取り消しますか？"
                          confirmLabel="取り消す"
                        />
                      )}
                    </li>
                  ))}
                </ul>
              )}

              {medicationGroups.length > 0 && (
                <p className="family__hint">
                  取り消されるのはこれから飲む予定だけです。すでに飲んだ記録は残ります。
                </p>
              )}

              {canEdit && (
                <div className="family__form">
                  <h3 className="family__form-title">お薬を追加する</h3>

                  <label className="family__field">
                    <span className="family__label">お薬の名前（必須）</span>
                    <input
                      type="text"
                      className="family__input"
                      value={medName}
                      onChange={(e) => setMedName(e.target.value)}
                      disabled={busySection !== null}
                    />
                  </label>

                  <label className="family__field">
                    <span className="family__label">分量</span>
                    <input
                      type="text"
                      className="family__input"
                      placeholder="例：1錠"
                      value={medDosage}
                      onChange={(e) => setMedDosage(e.target.value)}
                      disabled={busySection !== null}
                    />
                  </label>

                  <fieldset className="family__fieldset">
                    <legend className="family__label">飲む時間（1つ以上）</legend>
                    <div className="family__checks">
                      {MEDICATION_TIME_OPTIONS.map((option) => (
                        <label key={option.value} className="family__check">
                          <input
                            type="checkbox"
                            checked={medTimes.includes(option.value)}
                            onChange={() => toggleMedTime(option.value)}
                            disabled={busySection !== null}
                          />
                          <span>{option.label}</span>
                        </label>
                      ))}
                    </div>
                  </fieldset>

                  <label className="family__field">
                    <span className="family__label">何日分</span>
                    <select
                      className="family__input"
                      value={String(medDays)}
                      onChange={(e) => setMedDays(Number(e.target.value))}
                      disabled={busySection !== null}
                    >
                      {MEDICATION_DAY_OPTIONS.map((days) => (
                        <option key={days} value={String(days)}>
                          {days}日分
                        </option>
                      ))}
                    </select>
                  </label>

                  <button
                    type="button"
                    className="family__submit tap-feedback"
                    onClick={handleAddMedication}
                    disabled={busySection !== null}
                  >
                    {busySection === 'medications' ? '登録しています…' : 'お薬を登録する'}
                  </button>
                </div>
              )}
            </FamilySection>

            {/* 4. 荷物の受け取り予定 */}
            <FamilySection
              title="荷物の受け取り予定"
              count={`${deliveries.length}件`}
              open={openSection === 'deliveries'}
              onToggle={() => toggleSection('deliveries')}
            >
              {renderError('deliveries')}

              {deliveries.length === 0 ? (
                <p className="family__empty">登録された荷物はありません</p>
              ) : (
                <ul className="family__list">
                  {deliveries.map((item) => (
                    <li key={item.id} className="family__item">
                      <div className="family__item-text">
                        <span className="family__item-name">
                          {textOr(item.itemName, '荷物の名前未設定')}
                        </span>
                        <span className="family__item-sub">
                          {textOr(item.carrier, '配送業者の登録なし')}／到着予定{' '}
                          {textOr(formatDateTimeLabel(item.expectedAt), '未定')}
                        </span>
                      </div>
                      {canEdit && (
                        <DeleteControl
                          confirming={isConfirming('deliveries', item.id)}
                          busy={busySection !== null}
                          onAsk={() => askDelete('deliveries', item.id)}
                          onCancel={cancelDelete}
                          onConfirm={() => handleDeleteDelivery(item.id)}
                        />
                      )}
                    </li>
                  ))}
                </ul>
              )}

              {canEdit && (
                <div className="family__form">
                  <h3 className="family__form-title">荷物を追加する</h3>

                  <label className="family__field">
                    <span className="family__label">荷物の名前（必須）</span>
                    <input
                      type="text"
                      className="family__input"
                      value={deliveryName}
                      onChange={(e) => setDeliveryName(e.target.value)}
                      disabled={busySection !== null}
                    />
                  </label>

                  <label className="family__field">
                    <span className="family__label">配送業者</span>
                    <input
                      type="text"
                      className="family__input"
                      value={deliveryCarrier}
                      onChange={(e) => setDeliveryCarrier(e.target.value)}
                      disabled={busySection !== null}
                    />
                  </label>

                  <div className="family__field-row">
                    <label className="family__field">
                      <span className="family__label">到着予定日</span>
                      <input
                        type="date"
                        className="family__input"
                        value={deliveryDate}
                        onChange={(e) => setDeliveryDate(e.target.value)}
                        disabled={busySection !== null}
                      />
                    </label>
                    <label className="family__field">
                      <span className="family__label">到着予定時刻</span>
                      <input
                        type="time"
                        className="family__input"
                        value={deliveryTime}
                        onChange={(e) => setDeliveryTime(e.target.value)}
                        disabled={busySection !== null}
                      />
                    </label>
                  </div>

                  <label className="family__field">
                    <span className="family__label">メモ</span>
                    <input
                      type="text"
                      className="family__input"
                      value={deliveryMemo}
                      onChange={(e) => setDeliveryMemo(e.target.value)}
                      disabled={busySection !== null}
                    />
                  </label>

                  <button
                    type="button"
                    className="family__submit tap-feedback"
                    onClick={handleAddDelivery}
                    disabled={busySection !== null}
                  >
                    {busySection === 'deliveries' ? '登録しています…' : '荷物を登録する'}
                  </button>
                </div>
              )}
            </FamilySection>

            {/* 5. 連絡先 */}
            <FamilySection
              title="連絡先"
              count={`${contacts.length}件`}
              open={openSection === 'contacts'}
              onToggle={() => toggleSection('contacts')}
            >
              {renderError('contacts')}

              {contacts.length === 0 ? (
                <p className="family__empty">登録された連絡先はありません</p>
              ) : (
                <ul className="family__list">
                  {contacts.map((item) => (
                    <li key={item.id} className="family__item">
                      <div className="family__item-text">
                        <span className="family__item-name">
                          {textOr(item.name, '名前未設定')}
                          {item.isFavorite && <span className="family__badge">よく使う</span>}
                        </span>
                        <span className="family__item-sub">
                          {textOr(item.relationship, '続柄の登録なし')}／
                          {textOr(item.phoneNumber, '電話番号の登録なし')}
                        </span>
                      </div>
                      {canEdit && (
                        <DeleteControl
                          confirming={isConfirming('contacts', item.id)}
                          busy={busySection !== null}
                          onAsk={() => askDelete('contacts', item.id)}
                          onCancel={cancelDelete}
                          onConfirm={() => handleDeleteContact(item.id)}
                        />
                      )}
                    </li>
                  ))}
                </ul>
              )}

              {canEdit && (
                <div className="family__form">
                  <h3 className="family__form-title">連絡先を追加する</h3>

                  <label className="family__field">
                    <span className="family__label">名前（必須）</span>
                    <input
                      type="text"
                      className="family__input"
                      value={contactName}
                      onChange={(e) => setContactName(e.target.value)}
                      disabled={busySection !== null}
                    />
                  </label>

                  <label className="family__field">
                    <span className="family__label">続柄</span>
                    <input
                      type="text"
                      className="family__input"
                      value={contactRelationship}
                      onChange={(e) => setContactRelationship(e.target.value)}
                      disabled={busySection !== null}
                    />
                  </label>

                  <label className="family__field">
                    <span className="family__label">電話番号</span>
                    <input
                      type="tel"
                      className="family__input"
                      value={contactPhone}
                      onChange={(e) => setContactPhone(e.target.value)}
                      disabled={busySection !== null}
                    />
                  </label>

                  <label className="family__check">
                    <input
                      type="checkbox"
                      checked={contactFavorite}
                      onChange={(e) => setContactFavorite(e.target.checked)}
                      disabled={busySection !== null}
                    />
                    <span>よく電話する相手として表示する</span>
                  </label>

                  <button
                    type="button"
                    className="family__submit tap-feedback"
                    onClick={handleAddContact}
                    disabled={busySection !== null}
                  >
                    {busySection === 'contacts' ? '登録しています…' : '連絡先を登録する'}
                  </button>
                </div>
              )}
            </FamilySection>

            {/* 6. よく行く場所 */}
            <FamilySection
              title="よく行く場所"
              count={`${locations.length}件`}
              open={openSection === 'locations'}
              onToggle={() => toggleSection('locations')}
            >
              {renderError('locations')}

              {locations.length === 0 ? (
                <p className="family__empty">登録された場所はありません</p>
              ) : (
                <ul className="family__list">
                  {locations.map((item) => (
                    <li key={item.id} className="family__item">
                      <div className="family__item-text">
                        <span className="family__item-name">{textOr(item.name, '名前未設定')}</span>
                        <span className="family__item-sub">
                          {LOCATION_CATEGORY_LABELS[item.category] ?? 'その他'}／
                          {textOr(item.address, '住所の登録なし')}
                        </span>
                      </div>
                      {canEdit && (
                        <DeleteControl
                          confirming={isConfirming('locations', item.id)}
                          busy={busySection !== null}
                          onAsk={() => askDelete('locations', item.id)}
                          onCancel={cancelDelete}
                          onConfirm={() => handleDeleteLocation(item.id)}
                        />
                      )}
                    </li>
                  ))}
                </ul>
              )}

              <p className="family__hint">
                種類を「自宅」にした場所が、天気予報の地域として使われます。自宅は1件だけ保持され、新しく登録すると古いものは置き換わります。
              </p>

              {canEdit && (
                <div className="family__form">
                  <h3 className="family__form-title">場所を追加する</h3>

                  <label className="family__field">
                    <span className="family__label">名前（必須）</span>
                    <input
                      type="text"
                      className="family__input"
                      value={locationName}
                      onChange={(e) => setLocationName(e.target.value)}
                      disabled={busySection !== null}
                    />
                  </label>

                  <label className="family__field">
                    <span className="family__label">種類</span>
                    <select
                      className="family__input"
                      value={locationCategory}
                      onChange={(e) => setLocationCategory(e.target.value)}
                      disabled={busySection !== null}
                    >
                      {LOCATION_CATEGORY_OPTIONS.map((value) => (
                        <option key={value} value={value}>
                          {LOCATION_CATEGORY_LABELS[value]}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="family__field">
                    <span className="family__label">地名または住所</span>
                    <input
                      type="text"
                      className="family__input"
                      value={locationQuery}
                      onChange={(e) => {
                        setLocationQuery(e.target.value)
                        // 入力を変えたら、前回選んだ緯度経度は対応しなくなるため破棄する。
                        setGeoSelected(null)
                        setGeoResults([])
                        setGeoStatus('idle')
                      }}
                      disabled={busySection !== null}
                    />
                  </label>

                  <button
                    type="button"
                    className="family__sub-button tap-feedback"
                    onClick={handleGeocode}
                    disabled={busySection !== null || geoStatus === 'searching'}
                  >
                    {geoStatus === 'searching' ? '調べています…' : 'この地名で調べる'}
                  </button>

                  {geoStatus === 'empty' && (
                    <p className="family__hint">
                      見つかりませんでした。市区町村名などで調べ直してください
                    </p>
                  )}

                  {geoStatus === 'error' && (
                    <p className="family__notice">
                      地名を調べられませんでした。もう一度お試しください
                    </p>
                  )}

                  {geoResults.length > 0 && (
                    <ul className="family__geo-list">
                      {geoResults.map((result) => (
                        <li key={`${result.latitude},${result.longitude}`}>
                          <button
                            type="button"
                            className="family__geo-item tap-feedback"
                            onClick={() => setGeoSelected(result)}
                            disabled={busySection !== null}
                          >
                            <span className="family__geo-name">{textOr(result.name, '名称不明')}</span>
                            <span className="family__geo-detail">
                              {textOr(result.detail, '地域の情報なし')}
                            </span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}

                  {geoSelected && (
                    <p className="family__hint">
                      選択中の場所：{textOr(geoSelected.name, '名称不明')}（
                      {textOr(geoSelected.detail, '地域の情報なし')}）
                    </p>
                  )}

                  <button
                    type="button"
                    className="family__submit tap-feedback"
                    onClick={handleAddLocation}
                    disabled={busySection !== null}
                  >
                    {busySection === 'locations' ? '登録しています…' : '場所を登録する'}
                  </button>
                </div>
              )}
            </FamilySection>

            {/* 7. ゴミの日 */}
            <FamilySection
              title="ゴミの日"
              count={`週${garbageDayCount}日`}
              open={openSection === 'garbage'}
              onToggle={() => toggleSection('garbage')}
            >
              {renderError('garbage')}

              <p className="family__hint">空欄にした曜日は「収集なし」として扱われます。</p>

              <div className="family__form">
                {WEEKDAY_KEYS.map((key) => (
                  <label key={key} className="family__garbage-row">
                    <span className="family__garbage-day">{weekdayKanji(Number(key))}曜日</span>
                    <input
                      type="text"
                      className="family__input"
                      placeholder="例：燃えるゴミ"
                      value={garbage[key] ?? ''}
                      onChange={(e) => handleGarbageChange(key, e.target.value)}
                      disabled={!canEdit || busySection !== null}
                    />
                  </label>
                ))}

                {canEdit && (
                  <button
                    type="button"
                    className="family__submit tap-feedback"
                    onClick={handleSaveGarbage}
                    disabled={busySection !== null}
                  >
                    {busySection === 'garbage' ? '保存しています…' : 'ゴミの日を保存する'}
                  </button>
                )}

                {garbageSaved && <p className="family__saved">保存しました</p>}
              </div>
            </FamilySection>
          </>
        )}
      </div>
    </div>
  )
}
