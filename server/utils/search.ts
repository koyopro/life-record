/**
 * `ILIKE` のパターンを組み立てる。
 *
 * `%` `_` `\` は ILIKE のメタ文字なので、そのまま渡すと入力した文字と
 * 違うものに当たる。エスケープしてから前後に `%` を付ける。
 */
export function likePattern(query: string): string {
  const escaped = query.replace(/[\\%_]/g, (char) => `\\${char}`)
  return `%${escaped}%`
}
