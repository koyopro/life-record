import type { SectionDto } from '~~/shared/types/item'

/**
 * Section の並びを、クライアント側で計算する。
 *
 * ストアは編集をローカルへ即座に反映するため（docs/15-client-state.md）、
 * 追加・日付変更・並べ替えのあとも取り直しを待たずに正しい順で出せる必要が
 * ある。サーバー（server/utils/items.ts）の並びと同じ結果にならないと、
 * 取り直したときに記録が飛んで見える。
 */

/**
 * 詳細画面での並び（docs/03-functional-spec.md 3.1）。
 * 日付の新しい順、同じ日付の中は position 昇順。
 */
export function compareSectionsForDisplay(a: SectionDto, b: SectionDto): number {
  if (a.date !== b.date) return a.date < b.date ? 1 : -1
  if (a.position !== b.position) return a.position - b.position
  return a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0
}

export function sortSectionsForDisplay(sections: SectionDto[]): SectionDto[] {
  return [...sections].sort(compareSectionsForDisplay)
}

/**
 * 「本文」として扱う Section を選ぶ。最初に作られたもので、一覧カードに出す
 * 本文（`ItemDto.body`）と同じものを指す（docs/02-data-model.md 2.9-1）。
 */
export function pickPrimarySection(sections: SectionDto[]): SectionDto | null {
  return (
    [...sections].sort((a, b) => {
      if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? -1 : 1
      if (a.position !== b.position) return a.position - b.position
      return a.id < b.id ? -1 : 1
    })[0] ?? null
  )
}

/**
 * 同じ日付の記録の末尾に置くための position。
 * position は日付をまたいだ通し番号ではなく、同一日付内での並び順
 * （docs/02-data-model.md 2.4）。
 */
export function nextPositionIn(sections: SectionDto[], date: string): number {
  const sameDate = sections.filter((section) => section.date === date)
  if (sameDate.length === 0) return 0
  return Math.max(...sameDate.map((section) => section.position)) + 1
}
