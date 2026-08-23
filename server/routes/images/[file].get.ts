import {
  objectKeyFor,
  presignView,
  viewUrlCacheSeconds,
} from '~~/server/utils/s3'
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

  /*
   * リダイレクト自体も、次に URL が変わるまではブラウザに持たせておく。
   *
   * 毎回ここまで訊きに来ると、そのたびに Function の応答を待つことになり、
   * 一度読んだ画像でも表示が遅れる。行き先（署名付き URL）は窓の間ずっと
   * 同じなので、その残り時間だけ持たせてよい（server/utils/s3.ts）。
   */
  setResponseHeader(
    event,
    'Cache-Control',
    `private, max-age=${viewUrlCacheSeconds()}`,
  )

  return await sendRedirect(event, await presignView(objectKeyFor(file)), 302)
})
