import type { Fetched } from '~~/shared/types/fetched'

/**
 * 手元の控えと突き合わせる応答を作る（docs/15-client-state.md 14.2 の 4）。
 *
 * **時刻は読む前に打つ。**読んだ後に打つと、読んでから打つまでの間に入った
 * 更新を「この応答は知っている」と見なしてしまい、古い内容で戻すことになる。
 * その順番をここだけに閉じ込めるため、読む処理を受け取る形にしている。
 *
 * ```ts
 * export default defineEventHandler(async (event) =>
 *   fetched(async () => {
 *     ...
 *     return items
 *   }),
 * )
 * ```
 */
export async function fetched<T>(read: () => Promise<T>): Promise<Fetched<T>> {
  const fetchedAt = new Date().toISOString()
  return { fetchedAt, data: await read() }
}
