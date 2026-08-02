import { isSupabaseConfigured, SUPABASE_NOT_CONFIGURED_MESSAGE, supabase } from './supabase'

export interface Appointment {
  id: string
  title: string
  scheduled_at: string // ISO8601
  location: string | null
  departure_note: string | null
  status: string
  created_at: string
  updated_at: string
  deleted_at: string | null
}

export interface NewAppointmentInput {
  title: string
  scheduled_at: string
  location?: string | null
  departure_note?: string | null
  status?: string
}

export type UpdateAppointmentInput = Partial<NewAppointmentInput>

function ensureConfigured(): void {
  if (!isSupabaseConfigured) {
    throw new Error(SUPABASE_NOT_CONFIGURED_MESSAGE)
  }
}

const TABLE = 'appointments'

/** 指定日時以降（論理削除されていない）の予定を、日時の早い順に取得する。 */
export async function fetchUpcomingAppointments(fromISO: string): Promise<Appointment[]> {
  ensureConfigured()
  const { data, error } = await supabase
    .from(TABLE)
    .select('*')
    .is('deleted_at', null)
    .gte('scheduled_at', fromISO)
    .order('scheduled_at', { ascending: true })

  if (error) throw error
  return data ?? []
}

/** 論理削除されていない予定を全件、日時の早い順に取得する。 */
export async function fetchAllAppointments(): Promise<Appointment[]> {
  ensureConfigured()
  const { data, error } = await supabase
    .from(TABLE)
    .select('*')
    .is('deleted_at', null)
    .order('scheduled_at', { ascending: true })

  if (error) throw error
  return data ?? []
}

export async function createAppointment(input: NewAppointmentInput): Promise<Appointment> {
  ensureConfigured()
  const { data, error } = await supabase.from(TABLE).insert(input).select().single()
  if (error) throw error
  return data
}

export async function updateAppointment(id: string, input: UpdateAppointmentInput): Promise<Appointment> {
  ensureConfigured()
  const { data, error } = await supabase.from(TABLE).update(input).eq('id', id).select().single()
  if (error) throw error
  return data
}

/** 論理削除（deleted_at に現在時刻をセット）。物理削除はしない。 */
export async function softDeleteAppointment(id: string): Promise<void> {
  ensureConfigured()
  const { error } = await supabase
    .from(TABLE)
    .update({ deleted_at: new Date().toISOString(), status: 'deleted' })
    .eq('id', id)
  if (error) throw error
}
