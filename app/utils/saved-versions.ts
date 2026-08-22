/**
 * 「手元の保存が、どこまでサーバーに届いたか」を鍵ごとに覚えておく。
 *
 * 本文の取得（GET）と保存（PATCH / PUT）は別々に飛ぶので、**保存より前に
 * 出した取得の応答が、保存の後で届く**ことがある。届いた内容にはこちらの
 * 保存がまだ入っていないため、そのまま控えへ当てると書いた内容が消える。
 * 「送信中か（save-scheduler の busy）」だけでは、送り終わった直後の
 * この行き違いを防げない。
 *
 * そこで、保存できたときにサーバーが返した更新日時を控えておき、取得した
 * 内容の更新日時がそれより古ければ「こちらの保存を知らない内容」として
 * 退ける。比べるのはどちらもサーバーが打った時刻なので、端末の時計が
 * ずれていても判断が狂わない。
 *
 * Vue に依存させない（save-scheduler と同じ考え方）。
 */

export interface SavedVersions {
  /** 保存できた。サーバーが返した更新日時を控える。 */
  mark(key: string, updatedAt: string | null): void
  /**
   * サーバーから来た内容が、控えている保存より古いか。
   *
   * 古ければ、その内容にはこちらの保存がまだ入っていない。
   */
  isStale(key: string, serverUpdatedAt: string | null): boolean
  /** 鍵を捨てる（記録そのものが無くなったときなど）。 */
  forget(key: string): void
}

function toTime(value: string | null): number | null {
  if (!value) return null
  const time = Date.parse(value)
  return Number.isNaN(time) ? null : time
}

export function createSavedVersions(): SavedVersions {
  const marks = new Map<string, number>()

  return {
    mark(key, updatedAt) {
      const time = toTime(updatedAt)
      // 更新日時が分からない応答では判断材料が増えないので、控えない
      if (time === null) return
      const known = marks.get(key)
      // 応答が前後して届いても、いちばん新しい保存を覚えておく
      if (known !== undefined && known >= time) return
      marks.set(key, time)
    },

    isStale(key, serverUpdatedAt) {
      const mark = marks.get(key)
      if (mark === undefined) return false

      const server = toTime(serverUpdatedAt)
      // サーバーにその記録が無い（まだ作られていない・消えた扱い）。
      // こちらは保存できているので、届いた内容の方が古い
      if (server === null) return true

      return server < mark
    },

    forget(key) {
      marks.delete(key)
    },
  }
}
