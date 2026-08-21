import { useDb } from '~~/server/db'
import { icons } from '~~/server/db/schema'
import { IMAGE_PATH_PATTERN } from '~~/shared/types/image'
import { normalizeIconName, type IconDto } from '~~/shared/types/icon'

interface Body {
  name?: unknown
  path?: unknown
}

/**
 * アイコンを登録する（docs/11-scrapbox-notation.md 11.8）。
 *
 * 画像そのものはブラウザから S3 へ直接送られている（`POST /api/images`）。
 * ここが受け取るのは、その結果のパスと呼び名だけ。
 */
export default defineEventHandler(async (event): Promise<IconDto> => {
  const payload = await readBody<Body>(event)

  const name = normalizeIconName(String(payload?.name ?? ''))
  if (!name) {
    throw createError({
      statusCode: 400,
      message: '名前は英数字・`_`・`-` で32文字までです',
    })
  }

  const path = String(payload?.path ?? '')
  if (!IMAGE_PATH_PATTERN.test(path)) {
    throw createError({ statusCode: 400, message: '画像が正しくありません' })
  }

  const [row] = await useDb()
    .insert(icons)
    .values({ name, path })
    // 同じ名前は上書きする。差し替えたいときに、消してから登録し直さずに済む
    .onConflictDoUpdate({ target: icons.name, set: { path } })
    .returning({ id: icons.id, name: icons.name, path: icons.path })

  return row!
})
