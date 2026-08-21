export interface Shortcut {
  /** 反応するキー。`KeyboardEvent.key` の値で書く。 */
  keys: string[]
  /**
   * 先に押しておくキー（`g` → `t` の `g`）。
   *
   * RTM の移動系に合わせた2打鍵。単独キーは操作に使い切っているため、
   * 画面の移動はこちらに寄せる。
   */
  prefix?: string
  /** ヘルプ（`?`）での表示。省略時は keys[0] を使う。 */
  display?: string
  label: string
  group: string
  run: (event: KeyboardEvent) => void | Promise<void>
  /** 入力欄にフォーカスがあっても実行するか（Esc など）。 */
  allowInInput?: boolean
  /** Shift が押されていることを要求するか。 */
  shift?: boolean
  /**
   * `Cmd`（macOS）/ `Ctrl` を押した組み合わせか。
   *
   * 標準の操作と同じ打鍵を横取りすることになるので、`⌘ + C`（コピー）の
   * ように「その画面ではそちらのほうが自然」と言えるものだけに使う。
   */
  meta?: boolean
  /**
   * ブラウザ標準の操作に譲る条件。真を返す間はこの割り当てを使わない。
   *
   * `⌘ + C` は、文字を選んでいるならその選択を写したいはず、というように
   * 場面で持ち主が変わる。判断は割り当てた側に持たせる。
   */
  yieldToBrowser?: () => boolean
}

export interface ShortcutGroup {
  name: string
  items: Shortcut[]
}

/** 続きのキーを待つ時間。これを過ぎたら `g` を押したことは忘れる。 */
const PREFIX_TIMEOUT = 1500

/** 単独では操作にならないキー。待ち状態を壊さないよう素通りさせる。 */
const MODIFIER_KEYS = new Set(['Shift', 'Control', 'Alt', 'Meta'])

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  const tag = target.tagName
  return (
    tag === 'INPUT' ||
    tag === 'TEXTAREA' ||
    tag === 'SELECT' ||
    target.isContentEditable
  )
}

/*
 * 登録は画面ごとに分かれていても、打鍵の解釈は1つでなければならない。
 * 別々に window を監視すると、`g` を待っている登録と待っていない登録が
 * できてしまい、`g` `s`（タグへ移動）が `s`（タグを変更）も走らせる。
 * そのため、有効な定義をここに集めて1つの監視で捌く。
 */
const sources = shallowRef<ComputedRef<Shortcut[]>[]>([])

const active = computed(() => sources.value.flatMap((source) => source.value))

/** いま押されている途中の prefix。`g` のあと何を押すか待っている状態。 */
let pendingPrefix: string | null = null
let pendingTimer: ReturnType<typeof setTimeout> | undefined

function waitFor(prefix: string | null) {
  pendingPrefix = prefix
  clearTimeout(pendingTimer)
  // 押したことを忘れたまま次の操作をしたときに、
  // 意図しない組み合わせが起きないよう時間で戻す
  if (prefix) {
    pendingTimer = setTimeout(() => {
      pendingPrefix = null
    }, PREFIX_TIMEOUT)
  }
}

function matches(
  shortcut: Shortcut,
  event: KeyboardEvent,
  typing: boolean,
): boolean {
  if (!shortcut.keys.includes(event.key)) return false
  if (Boolean(shortcut.shift) !== event.shiftKey) return false
  // `c`（完了）と `⌘ + C`（コピー）のように、同じキーで別の操作になる
  if (Boolean(shortcut.meta) !== (event.metaKey || event.ctrlKey)) return false
  if (typing && !shortcut.allowInInput) return false
  if (shortcut.yieldToBrowser?.()) return false
  return true
}

function onKeydown(event: KeyboardEvent) {
  /*
   * すでに手前で扱われた打鍵には重ねて反応しない。
   *
   * ダイアログは自分で Esc を受けて閉じる（`@keydown.esc.prevent`）。
   * そのあとここでも Esc を扱うと、閉じるだけのつもりが選択解除まで
   * 進んでしまい、チェックしたタスクが消える。
   */
  if (event.defaultPrevented) return

  // Alt（macOS の option）は文字入力に使うので触らない
  if (event.altKey) return
  if (MODIFIER_KEYS.has(event.key)) return

  const typing = isTypingTarget(event.target)
  const list = active.value

  /*
   * `Cmd` / `Ctrl` との組み合わせは、そう宣言した割り当て（`meta`）だけが
   * 受け取る。2打鍵（`g` → `t`）の待ちには使わない。標準の操作と
   * 打鍵が重なるため、待ち状態を作ると `⌘ + S` のような無関係な操作まで
   * 巻き込む。
   */
  const withModifier = event.metaKey || event.ctrlKey

  // 続きを待っている間は、その組み合わせだけを見る。割り当てがなければ
  // 何もせずに待ちを解く。単独キーの操作まで走らせると、
  // 移動のつもりが編集になってしまうため。
  if (pendingPrefix && !withModifier) {
    const prefix = pendingPrefix
    waitFor(null)
    event.preventDefault()
    const shortcut = list.find(
      (item) => item.prefix === prefix && matches(item, event, typing),
    )
    if (shortcut) void shortcut.run(event)
    return
  }

  /*
   * `event.key` はすでに Shift を反映した文字（`*` は Shift+8 など）なので、
   * ここで Shift の有無を別途見る必要はない。`g` のような英字プレフィックスも、
   * Shift を押していれば大文字（`G`）になり自然に除外される。
   */
  if (!withModifier && !typing && list.some((item) => item.prefix === event.key)) {
    waitFor(event.key)
    event.preventDefault()
    return
  }

  for (const shortcut of list) {
    if (shortcut.prefix) continue
    if (!matches(shortcut, event, typing)) continue

    event.preventDefault()
    void shortcut.run(event)
    return
  }
}

/**
 * ショートカットを登録する（docs/08-todo-management.md 8.4）。
 *
 * ヘルプ（`?`）は、いま有効な定義そのものから生成する。
 * 実装とヘルプがずれないようにするため、一覧を別に持たない。
 */
export function useShortcuts(shortcuts: MaybeRefOrGetter<Shortcut[]>) {
  const source = computed(() => toValue(shortcuts))

  onMounted(() => {
    if (sources.value.length === 0) window.addEventListener('keydown', onKeydown)
    sources.value = [...sources.value, source]
  })

  onUnmounted(() => {
    sources.value = sources.value.filter((item) => item !== source)
    if (sources.value.length === 0) {
      window.removeEventListener('keydown', onKeydown)
      waitFor(null)
    }
  })

  /** ヘルプ表示用。登録されているものすべてを、グループごとにまとめる。 */
  const groups = computed<ShortcutGroup[]>(() => {
    const byGroup = new Map<string, Shortcut[]>()
    for (const shortcut of active.value) {
      const existing = byGroup.get(shortcut.group)
      if (existing) existing.push(shortcut)
      else byGroup.set(shortcut.group, [shortcut])
    }
    return [...byGroup].map(([name, items]) => ({ name, items }))
  })

  return { groups }
}

/** ヘルプでのキー表示。 */
export function shortcutDisplay(shortcut: Shortcut): string {
  const key = shortcut.display ?? shortcut.keys[0] ?? ''
  // `display` は装飾済みの文字（`?` など）を入れている箇所があるため、
  // 修飾キーを足すのは自分で宣言したものだけにする
  if (shortcut.meta) return `⌘ + ${key}`
  if (shortcut.display) return shortcut.display
  if (shortcut.prefix) return `${shortcut.prefix} ${key}`
  return shortcut.shift ? `Shift + ${key}` : key
}
