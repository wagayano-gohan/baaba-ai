// AIの回答本文を、画面表示用の読みやすい日本語へ整形する。
//
// Web検索を有効にすると、モデルは根拠を示すために本文へマークダウンのリンク記法
// （例: ([example.com](https://example.com/...?utm_source=openai)) ）や区切り線、
// 太字記号をそのまま埋め込んでくる。利用者が読む画面にURLや記号が出てはいけないため、
// system promptでの禁止に加え、表示直前にこの関数で二重に取り除く。
//
// 根拠URL自体は Edge Function 側が sources として別途保持しているため、
// ここで本文から取り除いても検証可能性は失われない。

/** ラベルがドメイン名（example.com 等）に見えるか。見える場合は本文に残す価値がない。 */
function looksLikeDomain(label: string): boolean {
  const trimmed = label.trim()
  if (trimmed === '' || /\s/.test(trimmed)) return false
  return /^[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(trimmed)
}

/**
 * マークダウン記法・URLを取り除き、日本語として自然に読める本文へ整形する。
 * 空の括弧や連続する空行など、除去によって生じた不自然な痕跡も併せて掃除する。
 */
export function sanitizeAnswerText(raw: string): string {
  if (typeof raw !== 'string' || raw === '') return ''

  let text = raw

  // 1. 画像記法 ![alt](url) は丸ごと削除する。
  text = text.replace(/!\[[^\]]*\]\([^)]*\)/g, '')

  // 2. リンク記法 [ラベル](URL)。
  //    ラベルがドメイン名なら出典表示なので丸ごと削除、
  //    それ以外は意味のある文言なのでラベルだけ残す。
  text = text.replace(/\[([^\]]*)\]\([^)]*\)/g, (_match, label: string) =>
    looksLikeDomain(label) ? '' : label,
  )

  // 3. 裸のURLを削除する（リンク記法を経ずに書かれる場合がある）。
  text = text.replace(/https?:\/\/[^\s()<>「」『』、。]+/g, '')

  // 4. 出典の名残として残った空の括弧を削除する。
  //    「（）」「()」「( 、 )」のように中身が記号・空白だけのものが対象。
  text = text.replace(/[（(][\s、,・;:]*[）)]/g, '')

  // 5. 強調・見出し・引用などの記号を外す（文字は残す）。
  text = text.replace(/\*\*([^*]+)\*\*/g, '$1')
  text = text.replace(/(^|[^*])\*([^*\n]+)\*/g, '$1$2')
  text = text.replace(/`{1,3}([^`]*)`{1,3}/g, '$1')
  text = text.replace(/^\s{0,3}#{1,6}\s*/gm, '')
  text = text.replace(/^\s{0,3}>\s?/gm, '')

  // 6. 水平線（--- や *** の行）を削除する。
  text = text.replace(/^\s*([-*_])\s*\1\s*\1[\s\-*_]*$/gm, '')

  // 7. 箇条書きの「- 」「・」は残しつつ、行頭の余分な空白を整える。
  text = text
    .split('\n')
    .map((line) => line.replace(/\s+$/, '').replace(/^[ \t]+(?=[-・\d])/, ''))
    .join('\n')

  // 8. 除去の結果できた空行の連続を最大1つにまとめ、前後の空白を落とす。
  text = text.replace(/\n{3,}/g, '\n\n')
  text = text.replace(/[ \t]{2,}/g, ' ')

  return text.trim()
}
