import type { Ref } from 'vue'
import {
  unappliedEdits,
  withLocalEdits,
  type LocalEdits,
} from '~/utils/local-edits'

/**
 * サーバーが正本のもの（タグ・スマートリスト）を、応答を待たずに直す。
 *
 * これらは IndexedDB を通さず、取り直した内容（`useFetch` の `data`）を
 * そのまま出している。押したそばから見た目を変えたいので手元へ先に当てるが、
 * **取りに行った後に直すと、その取り直しの応答が後から届いて直す前に戻る**
 * （docs/15-client-state.md 14.2 の 4）。
 *
 * そこで「この端末で直した分」を別に持ち、届いた内容より優先する。届いた内容が
 * 追いついたら、その分は落とす。時刻を比べないので、端末の時計にも応答が届く
 * 順番にも左右されない。
 *
 * @param key    画面をまたいで共有するための名前（`useState` の鍵）。
 * @param source サーバーから届いた一覧。
 */
export function useLocalEdits<T extends { id: string }>(
  key: string,
  source: Ref<T[]> | ComputedRef<T[]>,
) {
  const edits = useState<LocalEdits<T>>(`local-edits:${key}`, () => ({}))

  /** 画面が読む一覧。届いた内容に、この端末で直した分を重ねる。 */
  const list = computed(() => withLocalEdits(source.value, edits.value))

  /*
   * 届いた内容が追いついた分は、もう重ねない。
   * 重ね続けると、あとから他の端末で直された内容がいつまでも出なくなる。
   */
  watch(source, (rows) => {
    const next = unappliedEdits(rows, edits.value)
    if (Object.keys(next).length !== Object.keys(edits.value).length) {
      edits.value = next
    }
  })

  /** 応答を待たずに直す。 */
  function edit(id: string, values: Partial<T>): void {
    edits.value = { ...edits.value, [id]: { ...edits.value[id], ...values } }
  }

  /** 直すのをやめる（送れなかったとき）。 */
  function revert(id: string): void {
    if (!edits.value[id]) return
    const next = { ...edits.value }
    delete next[id]
    edits.value = next
  }

  return { list, edit, revert }
}
