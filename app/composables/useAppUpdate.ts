import { createUpdateGate } from '~/utils/update-gate'

/**
 * アプリの更新（新しい版の Service Worker）を、区切りの良いところで当てる
 * （docs/12-offline.md 12.2）。
 *
 * `registerType: 'autoUpdate'` は、新しい版が入った瞬間に読み込み直す。
 * タスクを書いている最中でも起きるので、打ちかけの入力が消え、キャレットも
 * 飛ぶ。そこで待つ側（`'prompt'`）にし、当てる時機はここで決める。
 *
 * - 書きかけ（useUnsaved）が無くなり、そのまま静かなら当てる
 * - 片付かないときは知らせだけ出し、「いま更新」で当てられるようにする
 */
export function useAppUpdate() {
  const { $pwa } = useNuxtApp()
  const unsaved = useUnsaved()

  /** 新しい版が用意できて、当てられるのを待っているか。 */
  const ready = computed(() => Boolean($pwa?.needRefresh))

  const gate = createUpdateGate({
    // 新しい Service Worker へ入れ替える。そのあと読み込み直される
    apply: () => void $pwa?.updateServiceWorker(),
  })

  watch(ready, (value) => {
    if (value) gate.ready()
  }, { immediate: true })

  watch(unsaved, (value) => gate.setBusy(value), { immediate: true })

  onBeforeUnmount(() => gate.stop())

  return {
    ready,
    /** 書きかけがあるので待っている。知らせの文面を変えるために使う。 */
    waiting: computed(() => ready.value && unsaved.value),
    applyNow: () => gate.applyNow(),
  }
}
