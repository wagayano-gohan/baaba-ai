// 共通CORS設定。
// ばーばAIのEdge Functionsはフロントエンド(ブラウザ/WebView)から直接呼び出されるため、
// プリフライト(OPTIONS)応答とレスポンスヘッダの両方にCORSヘッダを付与する必要がある。

export const corsHeaders: Record<string, string> = {
  // TODO: 本番運用時は '*' ではなく許可オリジンを明示的に限定すること
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type, x-device-token',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

/**
 * OPTIONSプリフライトリクエストであればここでレスポンスを返す。
 * それ以外のメソッドの場合は null を返し、呼び出し元の処理を継続させる。
 */
export function handlePreflight(req: Request): Response | null {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }
  return null
}
