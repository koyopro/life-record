import { objectKeyFor, presignView } from '~~/server/utils/s3'
import { IMAGE_PATH_PATTERN } from '~~/shared/types/image'

/**
 * 本文に書かれた `/images/<ID>.<拡張子>` を、S3 の画像へ解決する
 * （docs/07-open-questions.md Q4）。
 *
 * 期限つきの取得 URL へリダイレクトするだけで、画像そのものは
 * ここを通らない。バケットを非公開のまま保ちつつ、本文には
 * 期限のない固定パスを書ける。
 *
 * `/api/` の下に置かないのは、本文のパスをそのまま `src` に
 * 出せるようにするため。
 */
export default defineEventHandler(async (event) => {
  const file = getRouterParam(event, 'file') ?? ''

  if (!IMAGE_PATH_PATTERN.test(`/images/${file}`)) {
    throw createError({ statusCode: 404, message: '見つかりません' })
  }

  // 期限つき URL を指すので、リダイレクト自体はキャッシュさせない
  setResponseHeader(event, 'Cache-Control', 'private, no-store')

  return await sendRedirect(event, await presignView(objectKeyFor(file)), 302)
})
