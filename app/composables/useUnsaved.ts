import { isTypingTarget } from '~/utils/keyboard-surface'

/**
 * 「いま書きかけのものがあるか」を集める。
 *
 * アプリの更新（useAppUpdate）は画面を読み込み直すので、書いている途中に
 * 走らせない。ただし、何が書きかけかを知っているのはその部品だけなので、
 * **部品の側から申告してもらう**（useComposer と同じ形）。
 *
 * 申告は画面をまたいで1つに集める。印はモジュールに置く（useShortcuts と
 * 同じ。登録するのは画面が置かれたあと＝クライアントだけ）。
 */
const marks = shallowRef<(() => boolean)[]>([])

/**
 * 部品が「自分は書きかけを持っている」と申告する。
 *
 * @param unsaved 書きかけがあるか。呼ばれるたびに今の状態を返す。
 */
export function useUnsavedMark(unsaved: () => boolean): void {
  onMounted(() => {
    marks.value = [...marks.value, unsaved]
  })

  onBeforeUnmount(() => {
    marks.value = marks.value.filter((mark) => mark !== unsaved)
  })
}

/**
 * 書きかけがあるか。
 *
 * 申告されたもの（打ちかけのタスク・まだ保存していない入力）に加えて、
 * **入力欄にフォーカスがある間**も書いている最中と見なす。保存が済んでいても、
 * 読み込み直せばキャレットも変換中の文字も消えるため。
 */
export function useUnsaved() {
  /** 入力欄にフォーカスがあるか。 */
  const typing = ref(false)

  let later: ReturnType<typeof setTimeout> | undefined

  function refresh() {
    typing.value = isTypingTarget(document.activeElement)
  }

  /*
   * focusout の時点では移り先がまだ決まっていない（activeElement は body）。
   * 欄から欄へ移っただけで「入力をやめた」と見えてしまうので、次の番で見る。
   */
  function refreshLater() {
    clearTimeout(later)
    later = setTimeout(refresh, 0)
  }

  onMounted(() => {
    refresh()
    document.addEventListener('focusin', refresh)
    document.addEventListener('focusout', refreshLater)
  })

  onBeforeUnmount(() => {
    clearTimeout(later)
    document.removeEventListener('focusin', refresh)
    document.removeEventListener('focusout', refreshLater)
  })

  return computed(() => typing.value || marks.value.some((mark) => mark()))
}
