import { createClient } from '@supabase/supabase-js'

// Supabase接続情報は環境変数から読む（.env.local.example を参照して .env.local を作成すること）。
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

// 接続情報がまだ設定されていない開発初期段階でもアプリ自体は起動できるよう、
// ここでは throw せず isSupabaseConfigured フラグで呼び出し側に判断させる。
export const isSupabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey)

if (!isSupabaseConfigured) {
  // eslint-disable-next-line no-console
  console.error(
    '[supabase] VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY が設定されていません。' +
      ' .env.local.example を参考に .env.local を作成してください。',
  )
}

export const supabase = createClient(supabaseUrl || 'https://placeholder.invalid', supabaseAnonKey || 'placeholder')

export const SUPABASE_NOT_CONFIGURED_MESSAGE =
  'Supabaseの接続情報が設定されていません。.env.local に VITE_SUPABASE_URL と VITE_SUPABASE_ANON_KEY を設定してください。'
