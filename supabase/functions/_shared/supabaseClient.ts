import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'

/**
 * service_role クライアント。RLSをバイパスするため、
 * 権限確認（profile_memberships / role / PIN確認）は必ずFunction内で明示的に行うこと。
 * 本プロジェクトの重要操作Edge Functionsは基本的にこちらを使う。
 */
export function createServiceRoleClient(): SupabaseClient {
  const url = Deno.env.get('SUPABASE_URL')
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!url || !serviceRoleKey) {
    throw new Error('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY が設定されていません')
  }
  return createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

/**
 * 呼び出し元のAuthorizationヘッダ(Bearer JWT)をそのまま引き継ぐ anon クライアント。
 * JWT検証(auth.getUser())専用に使用する。RLS越しのデータ取得には使わない方針。
 */
export function createRequestScopedClient(req: Request): SupabaseClient {
  const url = Deno.env.get('SUPABASE_URL')
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')
  if (!url || !anonKey) {
    throw new Error('SUPABASE_URL / SUPABASE_ANON_KEY が設定されていません')
  }
  const authHeader = req.headers.get('Authorization') ?? ''
  return createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: authHeader } },
  })
}
