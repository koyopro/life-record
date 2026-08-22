import type { SectionDto } from '~~/shared/types/item'

/**
 * サーバーから届いた作業記録（Section）に、手元の内容を重ねる。
 *
 * 正本はサーバーなので、原則は届いた内容をそのまま採る。ただし
 * **手元の方が新しい本文は残す**（docs/15-client-state.md 14.2 の 4）。
 * 判断そのものは呼び出し側（ストア）が持つ。ここは重ね方だけを受け持ち、
 * Vue にも遅延送信にも依存させない。
 */
export interface SectionMergeRules {
  /**
   * その記録の本文は、届いた内容より手元の方が新しいか。
   *
   * 送信待ち・送信中／送信に失敗した／届いた内容がこちらの保存より古い、
   * のいずれか。
   */
  keepsLocalBody: (section: SectionDto) => boolean
  /**
   * その記録は、届いた応答より後に手元で保存されたか。
   *
   * その日の最初の打鍵で作った記録は、作る前に出した取得の応答には入って
   * いない。応答をそのまま採ると、作ったばかりの記録ごと消えて見える。
   */
  savedAfterResponse: (section: SectionDto) => boolean
}

export function mergeSections(
  local: SectionDto[],
  server: SectionDto[],
  rules: SectionMergeRules,
): SectionDto[] {
  const merged = server.map((section) => {
    if (!rules.keepsLocalBody(section)) return section
    const mine = local.find((s) => s.id === section.id)
    return mine ? { ...section, body: mine.body } : section
  })

  // 応答が知らない（応答より後に保存した）記録は、手元のまま残す。
  // 応答の方が新しければ、他の端末で消されたものとして落とす
  const unknown = local.filter(
    (section) =>
      !server.some((s) => s.id === section.id) && rules.savedAfterResponse(section),
  )

  return [...merged, ...unknown]
}
