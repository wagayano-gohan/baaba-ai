// 管理者PIN（4桁数字）のハッシュ化・照合ユーティリティ。
//
// 方針（正式確定仕様）:
//   - アルゴリズムは bcrypt（純JavaScript実装の bcryptjs。Deno上でネイティブ依存なしに動作する）
//   - コストファクタは 12
//   - 4桁数字は総当たりが容易なため、サーバー側でのみ保持する pepper を必ず連結してからハッシュ化する
//     （pepper は Supabase Secrets の PIN_PEPPER から取得。ソースコード・DB・フロントには置かない）
//   - PIN平文・pepperは、DB・audit_logs・ログ出力のいずれにも絶対に残さない
//
// pepper変更はすべての既存PINハッシュを無効化する（照合が必ず失敗する）ため、
// ローテーションを行う場合は全owner_adminのPIN再設定とセットで実施すること。

import bcrypt from 'https://esm.sh/bcryptjs@2.4.3'

/** bcryptのコストファクタ（確定値） */
const BCRYPT_COST = 12

/**
 * サーバー側pepperを取得する。未設定なら例外を投げて処理を中断させる
 * （pepperなしでハッシュ化・照合を行うと、pepper設定後に照合不能なハッシュが混在するため）。
 */
function getPepper(): string {
  const pepper = Deno.env.get('PIN_PEPPER')
  if (!pepper) {
    throw new Error('PIN_PEPPER が設定されていません（管理者PINのハッシュ化には必須です）')
  }
  return pepper
}

/** ハッシュ対象文字列（PIN平文 + pepper）。この戻り値はログ出力・保存を絶対に行わないこと。 */
function buildPepperedPin(pin: string): string {
  return `${pin}${getPepper()}`
}

/** 管理者PINをハッシュ化する（保存するのはこの戻り値のみ）。 */
export async function hashPin(pin: string): Promise<string> {
  const salt = await bcrypt.genSalt(BCRYPT_COST)
  return await bcrypt.hash(buildPepperedPin(pin), salt)
}

/** 管理者PINとハッシュを照合する。ハッシュが不正な形式の場合もfalseを返す（例外にしない）。 */
export async function verifyPin(pin: string, hash: string): Promise<boolean> {
  if (!hash) return false
  const peppered = buildPepperedPin(pin)
  try {
    return await bcrypt.compare(peppered, hash)
  } catch {
    return false
  }
}
