/**
 * いま画面に出ている入力欄（ItemComposer）への参照。
 *
 * `t`（タスクを追加）は画面をまたいで効かせたいので app.vue が持つが、
 * 入力欄そのものは画面ごとに置かれている。両者をつなぐために、
 * 入力欄のほうから自分を登録してもらう。
 */
const COMPOSER = Symbol('composer') as InjectionKey<Ref<(() => void) | null>>

/** app.vue が用意する。返り値を呼ぶと、いまの画面の入力欄へフォーカスする。 */
export function provideComposer(): Ref<(() => void) | null> {
  const focus = ref<(() => void) | null>(null)
  provide(COMPOSER, focus)
  return focus
}

/** ItemComposer が自分を登録する。画面に1つだけ置かれている前提。 */
export function useComposerRegistration(focus: () => void) {
  const registered = inject(COMPOSER, null)
  if (!registered) return

  onMounted(() => {
    registered.value = focus
  })

  onUnmounted(() => {
    // 別の入力欄がすでに登録していたら、それを消さない
    if (registered.value === focus) registered.value = null
  })
}
