import { useDb } from '~~/server/db'
import { listTagsWithCount } from '~~/server/utils/tags'
import type { TagDto } from '~~/shared/types/tag'

/** タグ一覧。付いている Item の件数つき。候補表示と絞り込みに使う。 */
export default defineEventHandler(async (): Promise<TagDto[]> => {
  return await listTagsWithCount(useDb())
})
