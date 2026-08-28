<script setup lang="ts">
import { lineClass, renderLine } from '~~/shared/utils/scrapbox/render'
import {
  codeBodyOf,
  continuationPrefix,
  dropPrefixUnit,
  indentOf,
  linesFromInput,
  parseScrapbox,
} from '~~/shared/utils/scrapbox/parse'
import type { Line } from '~~/shared/utils/scrapbox/types'
import { iconInsertion, searchEmoji, type EmojiEntry } from '~~/shared/utils/emoji'
import { toAppDate } from '~~/shared/utils/date'
import { caretAfterSplit, type LineSplit } from '~/utils/caret-shift'
import { isItemLinkDrag, readItemLinkDrag, type ItemDragPayload } from '~/utils/item-drag'
import { writeToClipboard } from '~/utils/clipboard'
import {
  clampColumn,
  closestLineIn,
  lineElementAt,
  linePoint,
  linePointAt,
  replaceSelection,
  selectionText,
  touchedLines,
  type LineSelection,
  type LineText,
} from '~/utils/line-selection'

/**
 * Scrapbox 記法の本文エディタ（docs/11-scrapbox-notation.md 11.6）。
 *
 * Scrapbox と同じく **行単位** で表示を切り替える。
 * - カーソルのある行 … 記法をそのままのテキストとして編集する
 * - それ以外の行     … 記法を解釈した表示
 *
 * 保存されるのは常に入力したままのテキスト。
 *
 * ただし、行頭のうち表示で余白になる部分（字下げの空白・引用の `>` ・`code:`）は
 * 入力欄にも入れず、表示と同じ余白として外側に付ける。行頭を文字のまま
 * 入力欄に入れると、カーソルの有無で文字の開始位置がずれてしまうため。
 */
const model = defineModel<string>({ required: true })

const props = withDefaults(
  defineProps<{
    placeholder?: string
    ariaLabel?: string
    /**
     * 読むだけにするか。記法の表示は変えず、編集の入口だけを閉じる。
     *
     * 本文の保存先（Section）が分かる前に書けてしまうと、書いたものの
     * 行き先が無い。取得が終わるまでの間だけこれを立てる（ItemDetail.vue）。
     */
    readonly?: boolean
    /**
     * 確定済みの見た目にするか。読むだけにしたうえで、入力欄としての
     * 囲み（枠線・背景・最低の高さ）と画像の追加も出さない。
     *
     * 過去の作業記録は既定でこの形で並べる（docs/03-functional-spec.md 3.2）。
     * 枠を並べたままにすると、どれが今日書ける欄なのか分からなくなる。
     */
    view?: boolean
  }>(),
  { placeholder: '', ariaLabel: '本文', readonly: false, view: false },
)

/** 書き換えを受け付けないか。`view` は読むだけを含む。 */
const locked = computed(() => props.readonly || props.view)

/** 行の配列。空文字でも1行として扱う。 */
const rawLines = computed(() => model.value.replace(/\r\n?/g, '\n').split('\n'))
const parsed = computed(() => parseScrapbox(model.value))

const activeIndex = ref<number | null>(null)
/**
 * 編集中の行の解析結果。
 *
 * 行頭（`prefix`）と、表示側と同じ外枠のクラスを得るために持つ。
 * `parsed` から引かないのは、`model` が親を往復して戻るまでの間、
 * 一手ぶん古い行を拾ってしまうため。
 */
const activeLine = shallowRef<Line | null>(null)
/** 編集中の行の中身。行頭は含まない。 */
const activeText = ref('')
const activePrefix = computed(() => activeLine.value?.prefix ?? '')
/**
 * 入力欄。行ごとに作り直さず、1つを使い回す。
 *
 * 行を移るたびに textarea を作り直すと、Enter で行を分けた直後に
 * 要素が差し替わってフォーカスが外れ、続きを打てなくなる。
 * 表示位置は flex の `order` で動かす。
 */
const input = ref<HTMLTextAreaElement | null>(null)

/** 複数行選択の範囲を描く土台。`Cmd`/`Ctrl`+`A` や `Shift`+矢印の続きを拾うため、フォーカスを持たせる。 */
const editorRoot = ref<HTMLDivElement | null>(null)

/*
 * 画面側のショートカットを止める印（app/composables/useShortcuts.ts）。
 *
 * 行をまたいで選んでいる間は、1行用の入力欄を離れてこの囲み自身が
 * フォーカスを持つ。印が無いと「入力していない」と見なされ、`Delete` で
 * タスクが消える・`c` で完了になる、といったことが起きる。属性名を
 * 直に書かず定数から作り、見る側と付ける側がずれないようにする。
 *
 * 読むだけのとき（`view` / `readonly`）は付けない。行の編集に入れないので
 * ここでキーを受けることが無く、押さえてしまうと**読んでいるだけなのに
 * 画面のショートカットが効かない**（クリックでフォーカスは入るため）。
 */
const keyboardSurface = computed(() =>
  locked.value ? {} : { [KEYBOARD_SURFACE_ATTR]: '' },
)

const isEmpty = computed(() => !model.value.trim())

/**
 * @param coalesce 直前の変更が地続きの「入力中のひとまとまり」とみなせるか。
 *   1文字ずつの通常入力（onInput）だけが true を渡す。それ以外（Enter・
 *   Backspace での行結合・Tab・複数行操作・貼り付けなど）は常に単独の
 *   取り消し単位にする（undo 参照）。
 */
function commit(lines: string[], options: { coalesce?: boolean } = {}) {
  // 本文の変更はすべてここを通る。読むだけのときはここで止めれば足りる
  if (locked.value) return

  const next = lines.join('\n')
  if (next === model.value) return
  pushUndoState(model.value, options.coalesce ?? false)
  model.value = next
}

// --- 取り消し（`Cmd`/`Ctrl` + `Z`） ---------------------------------------
//
// 1行編集用の textarea を使い回しているため（行を移るたびに、同じ要素の
// 値をプログラムから書き換える）、ブラウザ標準の取り消しには頼れない。
// `.value` を直接書き換えると、そのブラウザの取り消し履歴は失われてしまい、
// 「他の行に移ると直前の修正が戻せない」（`.value` の書き換えのたび履歴が
// 切れるため）といった崩れ方をする。本文の変更はすべて `commit` を通るため、
// ここで自前の取り消し履歴として持つ。

interface HistorySnapshot {
  value: string
  /** 復元後にカーソルを戻す位置。行編集の外（複数行操作など）で起きた変更は null。 */
  caret: { index: number; offset: number } | null
}

/** 際限なく伸びないよう、古いものから捨てる。 */
const HISTORY_LIMIT = 200
/** この間隔より短く続く入力は、同じひとまとまりの編集とみなす。 */
const TYPING_COALESCE_MS = 700

const undoStack: HistorySnapshot[] = []
const redoStack: HistorySnapshot[] = []

/** 直前の commit が「入力中のひとまとまり」として続けられるものだったか。 */
let typingBurst: { index: number | null; at: number } | null = null

function captureCaretForHistory(): { index: number; offset: number } | null {
  const index = activeIndex.value
  if (index === null) return null
  return { index, offset: input.value?.selectionStart ?? activeText.value.length }
}

function pushUndoState(previousValue: string, coalesce: boolean) {
  const now = Date.now()
  const activeIdx = activeIndex.value

  if (
    coalesce &&
    typingBurst &&
    typingBurst.index === activeIdx &&
    now - typingBurst.at <= TYPING_COALESCE_MS
  ) {
    // 続きの入力とみなし、新しい取り消し単位は作らない
    typingBurst.at = now
    return
  }

  undoStack.push({ value: previousValue, caret: captureCaretForHistory() })
  if (undoStack.length > HISTORY_LIMIT) undoStack.shift()
  redoStack.length = 0
  typingBurst = coalesce ? { index: activeIdx, at: now } : null
}

/** スナップショットへ戻す。カーソル位置が分かれば、その行の編集へ戻す。 */
function restoreSnapshot(snapshot: HistorySnapshot) {
  model.value = snapshot.value
  if (snapshot.caret) {
    void activate(snapshot.caret.index, snapshot.caret.offset, snapshot.value.split('\n'))
  } else {
    deactivate()
  }
}

function undo() {
  if (composing.value || undoStack.length === 0) return
  const previous = undoStack.pop()!
  redoStack.push({ value: model.value, caret: captureCaretForHistory() })
  typingBurst = null
  restoreSnapshot(previous)
}

function redo() {
  if (composing.value || redoStack.length === 0) return
  const next = redoStack.pop()!
  undoStack.push({ value: model.value, caret: captureCaretForHistory() })
  typingBurst = null
  restoreSnapshot(next)
}

/**
 * 行を1つだけ解析する。
 *
 * 行頭は前後の行に左右される（コードブロックの中かどうか）ため、
 * その行だけを見ても決められない。全体を解析してから取り出す。
 */
function lineAt(lines: string[], index: number): Line {
  const all = parseScrapbox(lines.join('\n'))
  return all[Math.min(Math.max(index, 0), all.length - 1)]!
}

/**
 * 行を編集状態にする。`caret` は行頭を除いた中身での位置。
 *
 * 行を書き換えた直後に呼ぶ場合は、その配列を `lines` で渡すこと。
 * `model` は親へ伝わってから戻ってくるため、直後に読み直すと
 * 更新前の内容を拾い、別の行を編集してしまう。
 */
async function activate(
  index: number,
  caret: 'start' | 'end' | number = 'end',
  lines: string[] = rawLines.value,
) {
  // 読むだけのときは、どの行も編集状態にしない（入力欄を出さない）
  if (locked.value) return

  // 1行だけの編集に戻るので、複数行選択の状態は捨てる
  lineSelection = null

  const target = Math.min(Math.max(index, 0), lines.length - 1)
  const line = lineAt(lines, target)
  activeIndex.value = target
  activeLine.value = line
  activeText.value = line.content
  closeEmojiPicker()
  lastDateInsert = null
  lastCaret = null

  await nextTick()
  const el = input.value
  if (!el) return
  el.focus()
  const position =
    caret === 'end' ? el.value.length : caret === 'start' ? 0 : caret
  el.setSelectionRange(position, position)
  resize()
}

/** 本文の中のカーソル位置（行と、行頭を除いた中身での位置）。 */
interface CaretPosition {
  index: number
  offset: number
}

/** 直前まで編集していた位置。フォーカスが外れたときに、その位置を覚えておく。 */
let lastCaret: CaretPosition | null = null

/**
 * いまのカーソル位置。編集中でなければ、外れる直前に控えた位置を使う
 * （ドラッグやボタン操作でフォーカスが外れるため）。どちらも無ければ null。
 */
function caretNow(): CaretPosition | null {
  const index = activeIndex.value
  const el = input.value
  if (index === null || !el) return lastCaret
  return { index, offset: el.selectionStart ?? activeText.value.length }
}

/**
 * 上下キーで行をまたぐときに保つ横位置（行頭からの文字数）。
 *
 * 行ごとに別の textarea なので、ブラウザが自前で持つ「上下移動中の
 * 横位置」の記憶は行をまたいだ時点で失われる。それを肩代わりする。
 * 上下キー以外での移動（クリック・タイプ・左右キーなど）では null に戻し、
 * 次に上下キーを押したときの実際のカーソル位置を使い直す。
 */
let desiredColumn: number | null = null

/**
 * `Shift`+矢印などで行を選んでいる間の範囲。選んでいなければ null。
 *
 * 1行編集用の textarea を複数行にまたがって選択することはできないため、
 * 複数行を選ぶ間は編集を抜けて（`deactivate`）表示側の行を
 * `Selection`/`Range` で直接選択する。
 *
 * `anchor` は固定端、`focus` は伸び縮みさせる端。`Shift`+矢印で始めた選択は
 * **行だけでなく桁も持つ**（`kind: 'text'`）。ふつうの入力欄と同じく、行の
 * 途中で `Shift`+`↓` を押せば、前後の行の同じ桁までが選ばれる。
 */
let lineSelection: LineSelection | null = null

/** 行の中身（記法込みの生テキストと、行頭を除いた中身）。 */
function lineTexts(): LineText[] {
  return parsed.value.map((line) => ({
    prefix: line.prefix,
    content: line.content,
    raw: line.raw,
  }))
}

/** 行の中身だけ（桁を行の長さに収めるために使う）。 */
function lineContents(): string[] {
  return parsed.value.map((line) => line.content)
}

function captureCaret() {
  const index = activeIndex.value
  const el = input.value
  if (index === null || !el) return
  lastCaret = { index, offset: el.selectionStart ?? activeText.value.length }
}

function deactivate() {
  // ドラッグ＆ドロップは、開始した時点で入力欄からフォーカスが外れる
  // （ドラッグ元の要素へ移るため）。「カーソル位置に挿入」を、外れた後の
  // drop 時点でも再現できるよう、外れる直前の位置を控えておく
  // （insertItemLink が使う）。
  captureCaret()
  activeIndex.value = null
  activeLine.value = null
  closeEmojiPicker()
  lastDateInsert = null
}

/**
 * 入力中の行を model に反映する。
 *
 * `v-model` は使わず、入力欄の値を直接読む。`v-model` と `@input` を
 * 併用すると、どちらが先に走るかで一手ぶん古い値を書き戻すことがある。
 */
function onInput(event?: Event) {
  const index = activeIndex.value
  if (index === null) return

  const previousText = activeText.value
  if (event?.target instanceof HTMLTextAreaElement) {
    activeText.value = event.target.value
  }

  const lines = [...rawLines.value]
  const prefix = activePrefix.value

  // 貼り付けで改行が入ることがあるので、その場合は行を分ける
  // （2行目以降にも行頭を引き継ぐ。linesFromInput を参照）
  if (activeText.value.includes('\n')) {
    closeEmojiPicker()
    const inserted = linesFromInput(activeText.value, activeLine.value)
    lines.splice(index, 1, ...inserted)
    commit(lines)
    void activate(index + inserted.length - 1, 'end', lines)
    return
  }

  lines[index] = prefix + activeText.value
  // 通常の1文字ずつの入力は、地続きの編集として1つの取り消し単位にまとめる
  commit(lines, { coalesce: true })
  // 変換中は行頭を取り直さない。入力欄の値やキャレットを触ると変換が壊れる
  if (!composing.value) {
    syncPrefix(lines, index, prefix)
    maybeAutoCloseBracket(previousText)
  }
  updateEmojiTrigger()
  resize()
}

/**
 * 書き換えた行を解析し直し、行頭の変化を入力欄に反映する。
 *
 * 行頭に空白や `>` を打つと、その文字は行頭（＝表示では余白）に移る。
 * 入力欄からは取り除き、消えた文字のぶんだけキャレットを戻す。
 *
 * @param prefix この行を組み立てるのに使った行頭
 */
function syncPrefix(lines: string[], index: number, prefix: string) {
  const line = lineAt(lines, index)
  activeLine.value = line
  if (line.prefix === prefix) return

  const caret = input.value?.selectionStart ?? activeText.value.length
  const moved = prefix.length + caret - line.prefix.length
  activeText.value = line.content
  void setCaret(Math.min(Math.max(moved, 0), line.content.length))
}

/** キャレット位置だけを動かす。行の入れ替えを伴わない操作で使う。 */
async function setCaret(start: number, end: number = start) {
  await nextTick()
  input.value?.setSelectionRange(start, end)
}

/** 編集中の行の中身を丸ごと差し替える。行頭は変えない。 */
function replaceActiveLine(text: string) {
  const index = activeIndex.value
  if (index === null) return
  activeText.value = text
  const lines = [...rawLines.value]
  lines[index] = activePrefix.value + text
  commit(lines)
  resize()
}

/** 編集中の行の行頭だけを差し替える。中身とキャレットは動かさない。 */
function replaceActivePrefix(prefix: string) {
  const index = activeIndex.value
  if (index === null) return
  const lines = [...rawLines.value]
  lines[index] = prefix + activeText.value
  commit(lines)
  // 解析し直すと行頭が渡したものと変わることがある（コードブロックの中など）
  syncPrefix(lines, index, prefix)
  resize()
}

/** 折り返しに合わせて高さを合わせる。 */
function resize() {
  const el = input.value
  if (!el) return
  el.style.height = 'auto'
  el.style.height = `${el.scrollHeight}px`
}

// --- 絵文字候補（Notion に倣い `:` で出す） -------------------------------
//
// 記法としては残さない。選んだ時点で実際の絵文字（Unicode 文字）に
// 置き換えるので、保存されるテキストに `:smile:` のようなコードは残らない。

/** 編集中の行における、候補を出すきっかけになった `:` の位置。 */
const emojiStart = ref<number | null>(null)
const emojiQuery = ref('')
const emojiIndex = ref(0)

/**
 * 候補ひとつ。絵文字（Unicode 文字）と、自分で登録したアイコン（画像）の
 * どちらかになる（docs/11-scrapbox-notation.md 11.8）。
 *
 * 絵文字は選んだ時点で文字に置き換わるが、アイコンは文字が無いので
 * `:name:` を本文に残し、表示のときに画像へ変える。
 */
type PickerEntry =
  | { kind: 'emoji'; name: string; char: string }
  | { kind: 'icon'; name: string; path: string }

const { map: iconMap, search: searchIcons } = useIcons()

/**
 * 候補。自分で登録したアイコンを先に出す。
 *
 * 数が少なく、探しているのはたいていこちら。絵文字は数が多いので、
 * 先に出すと登録したものが埋もれる。
 */
const emojiMatches = computed<PickerEntry[]>(() => {
  if (emojiStart.value === null) return []

  const icons = searchIcons(emojiQuery.value).map(
    (icon): PickerEntry => ({ kind: 'icon', name: icon.name, path: icon.path }),
  )
  const emoji = searchEmoji(emojiQuery.value, 8 - icons.length).map(
    (entry: EmojiEntry): PickerEntry => ({
      kind: 'emoji',
      name: entry.name,
      char: entry.char,
    }),
  )
  return [...icons, ...emoji]
})

function closeEmojiPicker() {
  emojiStart.value = null
  emojiQuery.value = ''
  emojiIndex.value = 0
}

/**
 * キャレットの直前にある `:` を探し、候補を出すべきか判断する。
 *
 * 対象にするのは、キャレットまでの間に空白を挟まない `:...` だけ。
 * `https://` のような URL の `:` で誤って出さないよう、直前が
 * `http` / `https` で終わる場合は除外する。
 */
function updateEmojiTrigger() {
  // クリックでの移動も、上下キーで保っていた横位置を忘れさせる
  desiredColumn = null
  const el = input.value
  if (!el || activeIndex.value === null) {
    closeEmojiPicker()
    return
  }
  if (el.selectionStart !== el.selectionEnd) {
    closeEmojiPicker()
    return
  }

  const caret = el.selectionStart ?? activeText.value.length
  const before = activeText.value.slice(0, caret)
  const at = before.lastIndexOf(':')
  if (at === -1) {
    closeEmojiPicker()
    return
  }

  const query = before.slice(at + 1)
  if (/\s/.test(query) || /(https?|ftp):?$/i.test(before.slice(0, at + 1))) {
    closeEmojiPicker()
    return
  }

  emojiStart.value = at
  emojiQuery.value = query
  emojiIndex.value = 0
}

/**
 * 候補を選び、`:` からキャレットまでを置き換える。
 *
 * 絵文字は文字そのものに、登録したアイコンは `:name: `（後ろに半角スペース）に
 * 置き換える。アイコンには文字が無いため、本文には名前を残しておく必要がある。
 */
function selectEmoji(entry: PickerEntry) {
  const start = emojiStart.value
  const el = input.value
  if (start === null || !el) return

  const caret = el.selectionStart ?? activeText.value.length
  const value = activeText.value
  const following = value.slice(caret)

  // アイコンは閉じの `:` の後ろに半角スペースを足す（iconInsertion）。
  // 足さないと、続けて打った文字が次のアイコン名として拾われてしまう
  const inserted =
    entry.kind === 'emoji' ? entry.char : iconInsertion(entry.name, following)

  const next = value.slice(0, start) + inserted + following
  replaceActiveLine(next)

  const newCaret = start + inserted.length
  void setCaret(newCaret, newCaret)
  closeEmojiPicker()
}

// --- キー操作 -----------------------------------------------------------
//
// 日本語入力の変換中は Enter などを横取りしない。変換の確定が
// 行の分割として扱われてしまうため。

const composing = ref(false)

/**
 * IME（日本語入力）が処理したキーか。
 *
 * `compositionstart` から `compositionend` までの印（`composing`）だけでは
 * 足りない。**Safari は変換を確定した Enter の前に `compositionend` を投げる**
 * ため、確定の Enter が届く時点で印は下りている。macOS アプリの WebView も
 * 同じなので、そのままだと確定のたびに行が分かれてしまう。
 *
 * - Chrome / Firefox … 確定の keydown は `isComposing` が true
 * - Safari            … `isComposing` は false になる。代わりに keyCode が 229
 *
 * 判定は ItemComposer / ItemDetail のタイトルと同じ（3か所で同じ規則にする）。
 */
function isImeKey(event: KeyboardEvent): boolean {
  return composing.value || event.isComposing || event.keyCode === 229
}

/**
 * キー操作の入り口。
 *
 * Vue のキー修飾子は使わない。`.delete` が Backspace の別名になっている等、
 * 名前と実際のキーが一致しない箇所があり、取り違えると事故になるため、
 * `event.key` を直接見る。
 */
function onKeydown(event: KeyboardEvent) {
  // 変換中のキーはすべて IME のもの。確定の Enter を改行にしないよう、
  // ここで一度に見送る（個々の処理では見ない）
  if (isImeKey(event)) return

  // 上下キー以外で動いたら、上下移動で保っていた横位置は忘れる
  if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') desiredColumn = null

  // 絵文字候補を出している間は、上下で選び Enter / Tab で確定する。
  // 行の分割やインデントなど、通常のキー操作より優先する。
  if (emojiStart.value !== null) {
    if (event.key === 'Escape') {
      event.preventDefault()
      closeEmojiPicker()
      return
    }
    if (emojiMatches.value.length > 0) {
      switch (event.key) {
        case 'ArrowDown':
          event.preventDefault()
          emojiIndex.value = (emojiIndex.value + 1) % emojiMatches.value.length
          return
        case 'ArrowUp':
          event.preventDefault()
          emojiIndex.value =
            (emojiIndex.value - 1 + emojiMatches.value.length) % emojiMatches.value.length
          return
        case 'Enter':
        case 'Tab':
          event.preventDefault()
          selectEmoji(emojiMatches.value[emojiIndex.value]!)
          return
      }
    }
  }

  switch (event.key) {
    case 'Enter':
      return onEnter(event)
    case 'Backspace':
      return onBackspace(event)
    case 'Delete':
      return onForwardDelete(event)
    case 'ArrowUp':
      return onArrow(event, -1)
    case 'ArrowDown':
      return onArrow(event, 1)
    case 'ArrowLeft':
      return onHorizontalArrow(event, -1)
    case 'ArrowRight':
      return onHorizontalArrow(event, 1)
    case 'Tab':
      return onTab(event)
    case 'Escape':
      event.preventDefault()
      return deactivate()
    case '[':
      return onOpenBracket(event)
    case 'd':
      // macOS の Ctrl+D は「カーソルより後ろを1文字消す」
      if (event.ctrlKey) return onForwardDelete(event)
      return
    case 'h':
      /*
       * macOS の Ctrl+H は Backspace。1文字消すところは入力欄が自分で行うが、
       * 行頭で押したときに前の行と繋ぐ（＝改行を消す）のはこちらの担当なので、
       * Backspace と同じ経路へ送る。行頭以外なら onBackspace は何もせずに
       * 素通しするため、二重に消えることはない。
       */
      if (event.ctrlKey) return onBackspace(event)
      return
    case 'k':
      // macOS の Ctrl+K は「カーソルより後ろを行末まで消す」(Emacs 由来)。
      // 空行なら消す文字がなく、そこにあるのは改行なので Ctrl+D と同じ扱いにする
      if (event.ctrlKey && activeText.value === '') return onForwardDelete(event)
      return
    case 't':
      if (event.ctrlKey) return insertToday(event)
      return
    case 'z':
    case 'Z':
      if (!event.metaKey && !event.ctrlKey) return
      event.preventDefault()
      // 入力欄は .editor の中にあるので、止めないと onContainerKeydown 側の
      // 同じ割り当てまで動いて2回ぶん戻ってしまう
      event.stopPropagation()
      return event.shiftKey ? redo() : undo()
    case 'y':
      // Windows 慣習の Ctrl+Y（Shift 無しの取り消し戻し）
      if (!event.ctrlKey) return
      event.preventDefault()
      event.stopPropagation()
      return redo()
  }
}

/**
 * 選択範囲があるときに `[` を打つと、それを角括弧で囲む（選択は保つ）。
 *
 * 選択が無いとき（キャレットだけの単純な入力）はここでは何もしない。
 * 日本語入力で「ひらがな」入力中に `[` キーを押すと、IME が composition を
 * 経由せずに全角の `「` へ直接置き換えることがある（`event.key` は半角の
 * `[` のままでも、実際に入るのは全角）。ここで `event.key` だけを見て
 * 決め打ちすると、その全角入力まで half-width の `[]` に変換してしまう。
 * そのため単純な入力は preventDefault せず、実際に入った文字を
 * `onInput`（`maybeAutoCloseBracket`）側で見てから決める。
 */
function onOpenBracket(event: KeyboardEvent) {
  const el = input.value
  if (activeIndex.value === null || !el) return

  const start = el.selectionStart ?? 0
  const end = el.selectionEnd ?? start
  if (start === end) return

  event.preventDefault()

  const value = activeText.value
  const selected = value.slice(start, end)

  replaceActiveLine(`${value.slice(0, start)}[${selected}]${value.slice(end)}`)
  void setCaret(start + 1, start + 1 + selected.length)
}

/**
 * 半角 `[` を単独で入力したときだけ、閉じ括弧 `]` を自動で足す。
 *
 * `onOpenBracket` を参照。実際に入った文字（`activeText`）を直前の値と
 * 比べ、キャレット位置に半角 `[` が1文字だけ挿し込まれた場合だけ動く。
 * 全角の `「` に化けた場合はここも素通りする。
 *
 * **カーソルの後ろに文字が残っている行では足さない。** 書き終えた行の
 * 途中に `[` を挿し込むのは、たいてい既にある文字を囲みたいときで、
 * そこに `]` が入ると閉じ括弧が二重になる（囲みたい文字の手前で閉じる）。
 * 行末に打つとき（＝これから中身を書くとき）だけ添える。
 */
function maybeAutoCloseBracket(previousText: string) {
  const index = activeIndex.value
  const el = input.value
  if (index === null || !el) return

  const caret = el.selectionStart
  if (caret === null || caret !== el.selectionEnd) return

  const value = activeText.value
  if (value.length !== previousText.length + 1) return
  if (value[caret - 1] !== '[') return
  // 行末（カーソルの後ろに文字が無い）ときだけ添える
  if (value.slice(caret) !== '') return
  if (value.slice(0, caret - 1) !== previousText.slice(0, caret - 1)) return
  if (value.slice(caret) !== previousText.slice(caret - 1)) return

  const next = `${value.slice(0, caret)}]${value.slice(caret)}`
  activeText.value = next
  const lines = [...rawLines.value]
  lines[index] = activePrefix.value + next
  // `[` の入力と地続きの、同じ取り消し単位にまとめる
  commit(lines, { coalesce: true })
  void setCaret(caret, caret)
}

/** 続けて `Ctrl` + `T` を押したとみなす間隔。この間なら日付をリンクへ差し替える。 */
const DATE_INSERT_REPEAT_MS = 1500

/** 直前に `Ctrl` + `T` で入れた日付の範囲。続けて押されたときの差し替えに使う。 */
let lastDateInsert: { at: number; start: number; end: number } | null = null

/**
 * `Ctrl` + `T` で今日の日付を挿入する。
 *
 * カーソルを動かさず・間を空けずにもう一度押すと、挿入した日付を
 * 日記へのリンク（`[/diary/YYYY-MM-DD]`）に差し替える。
 * 1回で常にリンクにはしない方針は、日付だけ書きたい場面
 * （期限のメモなど）を主にしているため。
 */
function insertToday(event: KeyboardEvent) {
  const el = input.value
  if (activeIndex.value === null || !el) return
  event.preventDefault()

  const now = Date.now()
  const date = toAppDate()
  const start = el.selectionStart ?? activeText.value.length
  const end = el.selectionEnd ?? start
  const value = activeText.value

  const upgrade =
    lastDateInsert !== null &&
    now - lastDateInsert.at <= DATE_INSERT_REPEAT_MS &&
    start === lastDateInsert.end &&
    end === lastDateInsert.end &&
    value.slice(lastDateInsert.start, lastDateInsert.end) === date

  if (upgrade) {
    const { start: linkStart, end: linkEnd } = lastDateInsert!
    const link = `[/diary/${date}]`
    replaceActiveLine(value.slice(0, linkStart) + link + value.slice(linkEnd))
    const caret = linkStart + link.length
    void setCaret(caret, caret)
    lastDateInsert = null
    return
  }

  replaceActiveLine(value.slice(0, start) + date + value.slice(end))
  const caret = start + date.length
  void setCaret(caret, caret)
  lastDateInsert = { at: now, start, end: caret }
}

/**
 * カーソルより後ろを1文字消す（`Delete` / macOS の `Ctrl+D`）。
 *
 * 行末では消す文字がないが、そこにあるのは改行なので次の行と結合する。
 * 行内なら何もせず、ブラウザ既定の削除に任せる。
 */
function onForwardDelete(event: KeyboardEvent) {
  const index = activeIndex.value
  const el = input.value
  if (index === null || !el) return

  const atEnd =
    el.selectionStart === el.value.length && el.selectionEnd === el.value.length
  if (!atEnd) return

  // コードブロック中の空行では、改行を消して次の行と繋げるのではなく、
  // その行の字下げを落として、そこでコードブロックを抜けさせる
  if (activeText.value === '' && activeLine.value?.type === 'codeBody') {
    event.preventDefault()
    replaceActivePrefix('')
    return
  }

  const lines = [...rawLines.value]
  if (index >= lines.length - 1) return

  event.preventDefault()
  const caret = el.value.length
  // 次の行の行頭は落とす。表示では余白なので、繋げても文字にはしない
  const next = lineAt(lines, index + 1)
  lines.splice(index, 2, activePrefix.value + activeText.value + next.content)
  commit(lines)
  void activate(index, caret, lines)
}

function onEnter(event: KeyboardEvent) {
  event.preventDefault()

  const index = activeIndex.value
  const el = input.value
  if (index === null || !el) return

  const caret = el.selectionStart ?? activeText.value.length
  const before = activeText.value.slice(0, caret)
  const after = activeText.value.slice(caret)

  const prefix = activePrefix.value
  const lines = [...rawLines.value]
  // 改行したら前の行の行頭を引き継ぐ（貼り付けと同じ規則）
  lines.splice(index, 1, prefix + before, continuationPrefix(activeLine.value) + after)
  commit(lines)
  void activate(index + 1, 'start', lines)
}

function onBackspace(event: KeyboardEvent) {
  const index = activeIndex.value
  const el = input.value
  if (index === null || !el) return
  if (el.selectionStart !== 0 || el.selectionEnd !== 0) return

  // 行頭に余白（字下げ・`>` ・`code:`）があるうちは、まずそれを外す
  const prefix = activePrefix.value
  if (prefix) {
    event.preventDefault()
    replaceActivePrefix(dropPrefixUnit(prefix))
    return
  }

  if (index === 0) return

  event.preventDefault()
  const lines = [...rawLines.value]
  const previous = lineAt(lines, index - 1)
  lines.splice(index - 1, 2, previous.raw + activeText.value)
  commit(lines)
  void activate(index - 1, previous.content.length, lines)
}

/**
 * 折り返しを考えた上で、`upto` 文字目までがテキストエリア内で
 * 何行ぶんの高さになるかを測る。
 *
 * textarea はキャレットの折り返し行を DOM から直接読めないため、
 * 値を一時的に切り詰めて高さ（`scrollHeight`）を測る。同期的に
 * 元の値へ戻すので、描画にもキャレット位置にも影響しない。
 */
function wrappedHeight(el: HTMLTextAreaElement, upto: number): number {
  const original = el.value
  el.value = original.slice(0, upto)
  const height = el.scrollHeight
  el.value = original
  return height
}

/** キャレットが折り返しの最初の行にあるか。 */
function isOnFirstRow(el: HTMLTextAreaElement, caret = el.selectionStart ?? 0): boolean {
  return wrappedHeight(el, caret) <= wrappedHeight(el, 0)
}

/** キャレットが折り返しの最後の行にあるか。 */
function isOnLastRow(el: HTMLTextAreaElement, caret = el.selectionEnd ?? el.value.length): boolean {
  return wrappedHeight(el, caret) >= wrappedHeight(el, el.value.length)
}

function onArrow(event: KeyboardEvent, delta: -1 | 1) {
  const index = activeIndex.value
  const el = input.value
  if (index === null || !el) return

  // 修飾キーを押していれば、カーソルではなく行そのものを動かす
  if (event.altKey) return moveBlock(event, delta)
  if (event.ctrlKey) return moveLine(event, delta)

  // Shift を押しながらの複数行選択は、コンテナ側の onContainerKeydown に
  // 任せる（ここで preventDefault すると、そちらまでイベントが届いても
  // 判断できなくなる）
  if (event.shiftKey) return

  // 保ちたい横位置は、一連の上下移動が始まった時点のものを使い続ける。
  // 行をまたいだ直後は、既にその行の端にいるため、ここで捉え直しては
  // 意味がない（捉え直すと、そこ止まりの位置に固定されてしまう）
  desiredColumn ??= el.selectionStart

  // 折り返しも含め、行内をまだ上下に動けるうちは行をまたがない
  if (delta === -1 && !isOnFirstRow(el)) return
  if (delta === 1 && !isOnLastRow(el)) return

  const next = index + delta
  if (next < 0 || next >= rawLines.value.length) return

  event.preventDefault()
  // 次の行が短ければ、setSelectionRange が末尾へ丸めてくれる
  void activate(next, desiredColumn)
}

/**
 * 行頭・行末で左右キーを押したら、前後の行へ移る（`←` / `→`）。
 *
 * 1行ずつ別の入力欄なので、放っておくと行の端で止まってしまう。本文全体で
 * ひとつながりの文章に見えている以上、端に来たら隣の行へ続けて動けるのが
 * 自然（上下キーが行をまたぐのと同じ）。
 *
 * 選択があるときは何もしない。入力欄の既定（選択を解いて端へ寄せる）に任せる。
 */
function onHorizontalArrow(event: KeyboardEvent, delta: -1 | 1) {
  // 修飾キー付きは、単語単位の移動や選択など別の意味を持つ
  if (event.shiftKey || event.altKey || event.ctrlKey || event.metaKey) return

  const index = activeIndex.value
  const el = input.value
  if (index === null || !el) return

  const start = el.selectionStart ?? 0
  const end = el.selectionEnd ?? start
  if (start !== end) return

  // 行の端に来ているときだけ、行をまたぐ
  if (delta === -1 && start !== 0) return
  if (delta === 1 && end !== el.value.length) return

  const next = index + delta
  if (next < 0 || next >= rawLines.value.length) return

  event.preventDefault()
  // 前の行へは末尾から、次の行へは先頭から入る（文字の並びどおりに動く）
  void activate(next, delta === -1 ? 'end' : 'start')
}

/**
 * 行を1つだけ、隣の行と入れ替える（`Ctrl`+`↑` / `↓`）。
 *
 * 字下げは動かさない。ぶら下がっている行は連れていかないので、
 * 階層をまたいで並べ替えたいときはこちらを使う。
 */
function moveLine(event: KeyboardEvent, delta: -1 | 1) {
  const index = activeIndex.value
  if (index === null) return

  const lines = [...rawLines.value]
  const target = index + delta
  if (target < 0 || target >= lines.length) return

  event.preventDefault()
  const caret = input.value?.selectionStart ?? activeText.value.length
  const [moved] = lines.splice(index, 1)
  lines.splice(target, 0, moved!)
  commit(lines)
  void activate(target, caret, lines)
}

/**
 * 段落を、同じ階層の隣の段落と入れ替える（`Option`+`↑` / `↓`）。
 *
 * ぶら下がっている行ごと動かすので、階層を保ったまま順番を変えられる。
 * 隣にあるのが同じ深さの段落でないとき（親の直下の先頭など）は動かさない。
 * 深さが変わる移動は、字下げ（`Tab`）と行の移動（`Ctrl`+`↑` / `↓`）で行う。
 */
function moveBlock(event: KeyboardEvent, delta: -1 | 1) {
  const index = activeIndex.value
  if (index === null) return

  const lines = [...rawLines.value]
  const all = parseScrapbox(lines.join('\n'))

  // コードブロックの中に段落の階層は無い。外に出さず、中だけで入れ替える
  if (all[index]?.type === 'codeBody') {
    if (all[index + delta]?.type === 'codeBody') moveLine(event, delta)
    return
  }

  const length = blockLength(all, index)
  const caret = input.value?.selectionStart ?? activeText.value.length

  // 動かす先は、行数ではなく隣の段落の分だけずらす。
  // 1行ずつ動かすと、隣の段落の途中に割り込んでしまう。
  let target: number
  if (delta === 1) {
    // 段落の次の行は、必ず同じか浅い深さになる（深い行は段落に入るため）。
    // 浅ければ、その段落は親の最後の子。入れ替える相手がいない
    const next = index + length
    if (next >= lines.length) return
    if (indentOf(all[next]!.raw) !== indentOf(all[index]!.raw)) return
    target = index + blockLength(all, next)
  } else {
    const previous = previousSiblingStart(all, index)
    if (previous < 0) return
    target = previous
  }

  event.preventDefault()
  const block = lines.splice(index, length)
  lines.splice(target, 0, ...block)
  commit(lines)
  void activate(target, caret, lines)
}

/**
 * 段落の行数。段落は、その行と、続くより深い字下げの行。
 *
 * Scrapbox では行頭の空白の数がそのまま階層なので、字下げの深い行は
 * その上の行にぶら下がっている。コードブロックは見出しと中身で
 * ひとまとまりなので、字下げに関わらず切り離さない。
 */
function blockLength(all: Line[], index: number): number {
  const start = all[index]
  if (!start) return 0
  // コードブロックの中身に階層は無いので、その行だけで1つ
  if (start.type === 'codeBody') return 1

  const base = indentOf(start.raw)
  let inCode = start.type === 'codeHeader'
  let end = index + 1
  while (end < all.length) {
    const line = all[end]!
    // コードブロックの中身は空行でも中断しない（字下げが浅くても続き）
    if (inCode && line.type === 'codeBody') {
      end++
      continue
    }
    if (indentOf(line.raw) <= base) break
    inCode = line.type === 'codeHeader'
    end++
  }
  return end - index
}

/**
 * 同じ深さで直前にある段落の先頭。無ければ -1。
 *
 * 上へ遡り、自分より深い行（＝手前の段落にぶら下がっている行）は飛ばす。
 * 最初に見つかった同じ深さの行が、直前の段落の先頭になる。
 * それより先に浅い行が来たら、それは親なので入れ替える相手はいない。
 */
function previousSiblingStart(all: Line[], index: number): number {
  const base = indentOf(all[index]!.raw)
  for (let start = index - 1; start >= 0; start--) {
    const line = all[start]!
    // コードブロックの中身は、見出しと一緒に動かすので単体では見ない
    if (line.type === 'codeBody') continue
    const indent = indentOf(line.raw)
    if (indent > base) continue
    return indent === base ? start : -1
  }
  return -1
}

/** 字下げを1段変える。Scrapbox では字下げが箇条書きの階層になる。 */
function onTab(event: KeyboardEvent) {
  const index = activeIndex.value
  if (index === null) return
  event.preventDefault()

  const prefix = activePrefix.value

  if (event.shiftKey) {
    // 全角スペースでの字下げも半角と同じく1段として外せるようにする（indentOf と揃える）
    if (!/^[ \t　]/.test(prefix)) return
    replaceActivePrefix(prefix.slice(1))
    return
  }

  replaceActivePrefix(` ${prefix}`)
}

// --- コードブロックのコピー ---------------------------------------------

/** 「コピーしました」を出しているコードブロック（見出しの行番号）。 */
const copiedCode = ref<number | null>(null)
let copiedTimer: ReturnType<typeof setTimeout> | null = null

/** コードブロックの中身をクリップボードへ。押したことが分かるよう、少しの間だけ知らせる。 */
async function copyCode(index: number) {
  const text = codeBodyOf(parsed.value, index)
  if (!(await writeToClipboard(text))) return

  copiedCode.value = index
  if (copiedTimer) clearTimeout(copiedTimer)
  copiedTimer = setTimeout(() => {
    copiedCode.value = null
    copiedTimer = null
  }, 1500)
}

onBeforeUnmount(() => {
  if (copiedTimer) clearTimeout(copiedTimer)
})

/** 表示側のリンクを押したときは編集に切り替えない。 */
/**
 * マウスでなぞり始めたら、キーボードで作った行の選択は捨てる。
 *
 * `Shift`+矢印の選択には「行頭・行末のどちらから伸ばしたか」（`edge`）が
 * 付いていて、コピーや削除の範囲はそれを見て決まる。なぞり直した選択に
 * 前の `edge` を当てると、見えている範囲と1行ずれる。
 */
function onContainerMousedown() {
  lineSelection = null
}

function onLineClick(event: MouseEvent, index: number) {
  const target = event.target as HTMLElement | null
  if (target?.closest('a')) return

  /*
   * 本文の画像は、押したら拡大して見せる（Scrapbox と同じ）。
   *
   * 本文の中では高さで頭打ちにしているので、そのままでは読めないことが多い。
   * その行の編集には入らない（編集したいときは画像の横を押す）。
   *
   * アイコン（`:name:`、`.sb-icon`）は文字の一部なので拡大しない。
   * 押したらその行の編集に入る。
   */
  const image = target?.closest('img.sb-image')
  if (image instanceof HTMLImageElement) {
    viewer.open(image.currentSrc || image.src, image.alt)
    return
  }

  void activate(index)
}

/**
 * 選択の起点・終点から、それが属する行の要素と行番号を探す。
 *
 * 見るのは**この本文の中だけ**。1つの画面に本文が複数ある
 * （タスク詳細の本文と作業記録）ため、囲みで区切らないと隣の本文の行を
 * 自分のものとして扱ってしまう。
 */
function closestLine(node: Node | null): { el: Element; index: number } | null {
  return closestLineIn(editorRoot.value, node)
}

/**
 * 選んでいる部分の、記法込みの生テキスト。選んでいなければ null。
 *
 * 複数行にまたがる選択を持ち出すときは、Scrapbox と同じく記法込みの
 * 生テキストを渡す。表示側は行頭（字下げ・`>` ・`code:`）を文字ではなく
 * 余白として見せているため、素直に写すとその部分が抜け落ちる。選んでいる
 * 範囲だけを判定し（`currentSelection`）、中身はブラウザの選択文字列では
 * なく model の生テキストから組み立て直す。
 */
function selectedLinesText(): string | null {
  const selection = currentSelection()
  if (!selection) return null
  return selectionText(selection, lineTexts())
}

/** 行を選んでいる間のコピー（`Cmd`/`Ctrl`+`C`）。 */
function onCopy(event: ClipboardEvent) {
  const text = selectedLinesText()
  if (text === null) return

  event.clipboardData?.setData('text/plain', text)
  event.preventDefault()
}

/**
 * 行を選んでいる間の切り取り（`Cmd`/`Ctrl`+`X`）。
 *
 * コピーと同じ生テキストを渡してから、選んだ行を消す。選択があるときの
 * 切り取りは「選んだものを持っていって消す」が当たり前の動きなので、
 * 行の選択でも同じにする。
 */
function onCut(event: ClipboardEvent) {
  const text = selectedLinesText()
  if (text === null) return

  event.clipboardData?.setData('text/plain', text)
  event.preventDefault()
  removeSelectedLines()
}

/**
 * `anchor` 行から `focus` 行までを、ブラウザの選択として実際に選ぶ。
 *
 * 行の前後関係ではなく `anchor`/`focus` の指定順を保つ
 * （`Selection.setBaseAndExtent` を使うと、上へ伸ばす選択も表現できる）。
 * こう組み立てておくと、コピーは既存の `onCopy` がそのまま拾える。
 */
async function applyLineSelection(selection: LineSelection) {
  await nextTick()
  const anchorLine = selection.kind === 'line' ? selection.anchor : selection.anchor.line
  const focusLine = selection.kind === 'line' ? selection.focus : selection.focus.line
  const anchorEl = lineElementAt(editorRoot.value, anchorLine)
  const focusEl = lineElementAt(editorRoot.value, focusLine)

  if (anchorEl && focusEl) {
    // 行まるごとのときは、伸ばす向きに合わせて端を選ぶ（行頭 → 行末）。
    // 桁を持つ選択は、その桁をそのまま端点にする
    const forward = anchorLine <= focusLine
    const from =
      selection.kind === 'line'
        ? linePoint(anchorEl, forward ? 'start' : 'end')
        : linePointAt(anchorEl, selection.anchor.column)
    const to =
      selection.kind === 'line'
        ? linePoint(focusEl, forward ? 'end' : 'start')
        : linePointAt(focusEl, selection.focus.column)
    window.getSelection()?.setBaseAndExtent(from.node, from.offset, to.node, to.offset)
  }

  // Shift+矢印を続けて押せるよう、フォーカスをコンテナへ移しておく
  // （1行編集用の textarea は複数行にまたがれないため、すでに外れている）。
  // 選択を組み立てられなかったときも、フォーカスが本文の外へ逃げないように、
  // ここは必ず通す
  editorRoot.value?.focus({ preventScroll: true })
}

/**
 * 選択を1行分だけ伸ばす/縮める。
 *
 * 固定端（`anchor`）はそのままに、`focus` だけ動かす。桁を持つ選択
 * （`Shift`+矢印）は、伸ばした先でも**同じ桁**を指す。行が短ければその行末
 * までに収めるが、覚えている桁（`desired`）は変えないので、長い行まで
 * 進めば元の桁へ戻る（`Shift` なしの上下移動と同じ）。
 *
 * これ以上行を移れないとき（一番上の行で `↑`・一番下の行で `↓`）は、
 * その行の端まで選ぶ。ふつうの入力欄と同じで、本文の先頭・末尾までが
 * 選ばれることになる。
 *
 * まだ1行を編集中なら、ここで抜けて表示側の選択に持ち替える。
 * 伸ばした先がちょうど固定端に戻ったときは、何も選んでいない状態なので
 * その行の編集へ戻す（ふつうの入力欄と同じ）。
 */
async function extendLineSelection(delta: -1 | 1) {
  const selection = lineSelection
  if (!selection) return

  const last = rawLines.value.length - 1

  if (selection.kind === 'line') {
    if (activeIndex.value !== null) deactivate()
    const focus = Math.min(Math.max(selection.focus + delta, 0), last)
    lineSelection = { ...selection, focus }
    await applyLineSelection(lineSelection)
    return
  }

  const contents = lineContents()
  const target = selection.focus.line + delta
  const line = Math.min(Math.max(target, 0), last)
  const beyond = target < 0 || target > last
  // 行を移れないときは行の端まで（↑ なら行頭、↓ なら行末）。
  // 覚えている桁（`desired`）は変えないので、押し戻せば元の桁に戻る
  const column = beyond
    ? delta === -1
      ? 0
      : (contents[line]?.length ?? 0)
    : clampColumn(selection.desired, contents, line)
  const focus = { line, column }

  // 何も選んでいない状態に戻ったら、その位置の編集へ戻す
  if (focus.line === selection.anchor.line && focus.column === selection.anchor.column) {
    lineSelection = null
    window.getSelection()?.removeAllRanges()
    void activate(focus.line, focus.column)
    return
  }

  if (activeIndex.value !== null) deactivate()
  lineSelection = { ...selection, focus }
  await applyLineSelection(lineSelection)
}

/** `Cmd`/`Ctrl`+`A` で本文全体を選択する。 */
async function selectAllLines() {
  if (rawLines.value.length === 0) return
  if (activeIndex.value !== null) deactivate()
  lineSelection = { kind: 'line', anchor: 0, focus: rawLines.value.length - 1 }
  await applyLineSelection(lineSelection)
}

/**
 * いま選んでいる範囲。選んでいなければ null。
 *
 * **コピー・切り取り・貼り付け・削除・字下げは、すべてここを通す。**
 * どれか1つだけ別の条件で範囲を決めていると、「コピーはできるのに
 * 切り取りだけ効かない」という食い違いが起きるため。
 *
 * 自分のものだと言える選択だけを返す:
 *
 * - 1行を編集している間の選択は入力欄（textarea）のもの。行の選択ではない
 * - 端が**この本文の外**にある選択は別の本文のもの（1つの画面に本文が
 *   複数ある: タスク詳細の本文と、日付ごとの作業記録）
 * - 1行の中の部分選択（コードの一部だけ選ぶなど）は、行をまたがないので
 *   ブラウザの既定の動きに任せる
 *
 * 前後関係ではなく選んだ向き（`anchor` → `focus`）のまま返す。選び直すとき
 * （字下げのあとなど）に、上へ伸ばした選択をそのまま作り直せるようにする。
 */
function currentSelection(): LineSelection | null {
  if (activeIndex.value !== null) return null

  const selection = window.getSelection()
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) return null

  const anchor = closestLine(selection.anchorNode)
  const focus = closestLine(selection.focusNode)
  if (!anchor || !focus) return null

  // キーボードで作った選択は桁まで分かっているので、そのまま使う
  if (lineSelection) return lineSelection

  // ここから先はマウスでなぞった選択。桁を持たないので行まるごととして扱う
  if (
    anchor.index === focus.index &&
    selection.toString().trim() !== anchor.el.textContent?.trim()
  ) {
    return null
  }

  return { kind: 'line', anchor: anchor.index, focus: focus.index }
}

/**
 * 複数行選択したまま `Tab` を押すと、選んだ行すべての字下げを1段
 * まとめて増減する（Scrapbox と同じ）。
 */
function indentSelectedLines(delta: 1 | -1) {
  const selection = currentSelection()
  if (!selection) return

  const range = touchedLines(selection, lineContents())
  if (!range) return

  const { anchor, focus } = range
  const start = Math.min(anchor, focus)
  const end = Math.max(anchor, focus)

  const lines = [...rawLines.value]
  for (let i = start; i <= end; i++) {
    if (delta === 1) {
      lines[i] = ` ${lines[i]}`
    } else if (/^[ \t　]/.test(lines[i]!)) {
      lines[i] = lines[i]!.slice(1)
    }
  }
  commit(lines)

  // 行の中身は変わっても番号も桁も変わらない（増えるのは行頭）ので、
  // 同じ範囲で選択し直す
  void applyLineSelection(lineSelection ?? { kind: 'line', anchor, focus })
}

/**
 * 選んだ行をまとめて消す（複数行選択中の `Delete` / `Backspace`）。
 *
 * 選択があるときの `Delete` は「選んだものを消す」が当たり前の動きなので、
 * 行の選択でも同じにする。消したあとは、その場所（消した行が末尾なら
 * その手前）の編集に戻る。続けて書けるようにするため。
 */
function removeSelectedLines() {
  const selection = currentSelection()
  if (!selection) return

  const { lines, caret } = replaceSelection(selection, lineTexts(), '')

  lineSelection = null
  window.getSelection()?.removeAllRanges()

  commit(lines)
  void activate(caret.line, caret.column, lines)
}

/**
 * 複数行選択の間だけ効くキー操作。
 *
 * 1行編集用の textarea から抜けている間は、キー入力を受け取る先が
 * 無くなってしまうため、`.editor` 自身にフォーカスを持たせて拾う。
 */
function onContainerKeydown(event: KeyboardEvent) {
  // 取り消し（Cmd/Ctrl+Z）。複数行選択などで1行編集用の textarea を
  // 抜けている間（フォーカスがこのコンテナ側にある間）も効くようにする。
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'z') {
    event.preventDefault()
    if (event.shiftKey) redo()
    else undo()
    return
  }
  if (event.ctrlKey && !event.metaKey && event.key.toLowerCase() === 'y') {
    event.preventDefault()
    redo()
    return
  }

  // 全選択（Cmd+A）。1行だけの選択（textarea の既定動作）を上書きする。
  // Ctrl+A は含めない。macOS では Ctrl+A は「行頭へ移動」という
  // OS 標準の Emacs 風操作なので、そちらを奪ってはいけない
  if (event.metaKey && !event.ctrlKey && event.key.toLowerCase() === 'a') {
    event.preventDefault()
    void selectAllLines()
    return
  }

  if (lineSelection && event.key === 'Tab') {
    event.preventDefault()
    indentSelectedLines(event.shiftKey ? -1 : 1)
    return
  }

  if (lineSelection && (event.key === 'Delete' || event.key === 'Backspace')) {
    event.preventDefault()
    removeSelectedLines()
    return
  }

  if (lineSelection && event.key === 'Escape') {
    event.preventDefault()
    lineSelection = null
    window.getSelection()?.removeAllRanges()
    return
  }

  const vertical = event.key === 'ArrowDown' || event.key === 'ArrowUp'
  const horizontal = event.key === 'ArrowLeft' || event.key === 'ArrowRight'
  if (!vertical && !horizontal) return

  /*
   * 複数行選択中に Shift なしで矢印キーを押したときは、選択をやめて
   * その行の編集に戻る（カーソル位置だけが変わる、という見た目の期待に合わせる）。
   */
  if (lineSelection && !event.shiftKey && !event.metaKey && !event.ctrlKey && !event.altKey) {
    event.preventDefault()
    const selection = lineSelection
    lineSelection = null
    window.getSelection()?.removeAllRanges()
    if (selection.kind === 'text') {
      // 桁を持つ選択は、動かしていた端にカーソルがある
      void activate(selection.focus.line, selection.focus.column)
    } else {
      const toStart = event.key === 'ArrowUp' || event.key === 'ArrowLeft'
      void activate(selection.focus, toStart ? 'start' : 'end')
    }
    return
  }

  if (!event.shiftKey) return

  const delta: -1 | 1 = event.key === 'ArrowDown' || event.key === 'ArrowRight' ? 1 : -1

  // すでに行の選択が始まっていれば、そのまま伸ばす/縮める
  if (lineSelection) {
    event.preventDefault()
    void extendLineSelection(delta)
    return
  }

  // まだ1行を編集中なら、行の端まで来ているときだけ行をまたぐ選択を始める。
  // 行内をまだ選べるうちは、textarea の既定の選択に任せる
  const index = activeIndex.value
  const el = input.value
  if (index === null || !el) return

  /*
   * 入力欄の選択のうち、動かしている端（focus）と動かさない端（anchor）。
   * すでに行の中で選んでいるなら、その向き（selectionDirection）を引き継ぐ。
   */
  const backward = el.selectionDirection === 'backward'
  const anchorColumn = backward ? (el.selectionEnd ?? 0) : (el.selectionStart ?? 0)
  const focusColumn = backward ? (el.selectionStart ?? 0) : (el.selectionEnd ?? 0)

  const atBoundary = vertical
    ? delta === -1
      ? isOnFirstRow(el, focusColumn)
      : isOnLastRow(el, focusColumn)
    : delta === -1
      ? focusColumn === 0
      : focusColumn === el.value.length

  if (!atBoundary) return

  event.preventDefault()

  /*
   * これ以上行を移れないとき（一番上の行で `↑`・一番下の行で `↓`）は、
   * その行の端まで選ぶ。ふつうの入力欄と同じで、本文の先頭・末尾までが
   * 選ばれることになる。
   *
   * 行をまたがないので、入力欄（textarea）の選択のまま扱う。表示側の選択に
   * 持ち替えると、1行の中を選んだだけなのに編集から抜けてしまう。
   */
  if (index + delta < 0 || index + delta > rawLines.value.length - 1) {
    const edge = delta === -1 ? 0 : el.value.length
    const [start, end] = edge < anchorColumn ? [edge, anchorColumn] : [anchorColumn, edge]
    el.setSelectionRange(start, end, delta === -1 ? 'backward' : 'forward')
    return
  }

  /*
   * 上下は**カーソルと同じ桁**まで伸ばす（ふつうの入力欄と同じ）。
   * 左右は行をまたいだ先の端まで（→ なら次の行の行頭、← なら前の行の行末）。
   * 桁を1つずつ動かすことはできないため（表示側には入力欄が無い）、
   * 左右で始めた選択もその後は1行ずつ伸びる。
   */
  const desired = vertical ? focusColumn : delta === 1 ? 0 : Number.POSITIVE_INFINITY
  lineSelection = {
    kind: 'text',
    anchor: { line: index, column: anchorColumn },
    focus: { line: index, column: focusColumn },
    desired,
  }
  void extendLineSelection(delta)
}

/**
 * 外から本文が入れ替わったとき（別画面での更新など）に追随する。
 *
 * 編集そのものは切らない。書いている途中に解除されると、
 * 打ちかけの入力が行き場を失うため、内容だけ合わせ直す。
 */
watch(model, () => {
  const index = activeIndex.value
  if (index === null) return

  /*
   * 変換中は入力欄に触れない。
   *
   * 入力欄の値（`activeText`）を書き換えると、その時点で日本語入力の変換が
   * 打ち切られる（勝手に確定した・消えたように見える）。本文は送信が通った
   * あとに読み直される（useSync の onLocalChange）ため、書いている最中にも
   * 外から入れ替わることがあり、その1回で変換中の文字が確定してしまう。
   *
   * 見送っても困らない。変換中も打鍵ごとに commit しているので、次の打鍵で
   * この watch が走って合わせ直す。そもそも書いている本人の内容のほうが
   * 新しいので、そちらを残すのが正しい（docs/15-client-state.md 14.2）。
   */
  if (composing.value) return

  if (index > parsed.value.length - 1) {
    // 行そのものが無くなったときだけ諦める
    deactivate()
    return
  }

  const line = parsed.value[index]!
  const editing = activePrefix.value + activeText.value
  activeLine.value = line
  if (line.raw !== editing) activeText.value = line.content
})

// --- 画像（docs/11-scrapbox-notation.md 11.7） ---------------------------

const viewer = useImageViewer()

const images = useImageUpload()
const filePicker = ref<HTMLInputElement | null>(null)
/** 本文の上に画像が乗っているか。落とせることが分かるようにする。 */
const dragging = ref(false)

/**
 * 画像を**カーソルのあった位置**へ、1行として差し込む。
 *
 * 行の途中に混ぜると、書きかけの文が画像記法で割られてしまうため、
 * 常に1行として入れる。そのうえで**カーソルの位置で行を割り**、その間へ
 * 置く。空行にカーソルがあればその行がそのまま画像になり、書きかけの行なら
 * カーソルより後ろは画像の下へ回る。
 *
 * 行頭（字下げ・引用）は貼り付けや改行と同じ規則で引き継ぐ
 * （`continuationPrefix`）。位置が分からなければ末尾に足す。
 *
 * 差し込んだ後の行と、次の画像を入れる位置（差し込んだ行の次）を返す。
 * 複数枚を順に並べるためと、差し込んだ直後に続きを編集するため。行は
 * `model` が親を往復して戻るまで古いままなので、呼び出し側へ渡す。
 */
interface ImageInsert {
  lines: string[]
  /** 画像の次（続きを書く場所）。 */
  at: CaretPosition
  /**
   * どの行をどこで割ったか。末尾に足したときは割っていないので null。
   *
   * 上げている間も書き続けている人のカーソルを、見た目の同じ場所に
   * 留めるために使う（`caretAfterSplit`）。
   */
  split: LineSplit | null
  /** 差し込みで増えた行数。 */
  added: number
}

function insertImageAt(path: string, at: CaretPosition | null): ImageInsert {
  const lines = [...rawLines.value]
  const image = `[${path}]`

  if (!at || at.index < 0 || at.index >= lines.length) {
    lines.push(image)
    commit(lines)
    // 末尾に足しただけなので、いまある行の番号は動かない
    return { lines, at: { index: lines.length, offset: 0 }, split: null, added: 0 }
  }

  const line = lineAt(lines, at.index)
  const offset = Math.min(Math.max(at.offset, 0), line.content.length)
  const before = line.content.slice(0, offset)
  const after = line.content.slice(offset)
  const prefix = continuationPrefix(line)

  const replacement = [
    ...(before ? [line.prefix + before] : []),
    prefix + image,
    ...(after ? [prefix + after] : []),
  ]
  lines.splice(at.index, 1, ...replacement)
  commit(lines)

  return {
    lines,
    // 差し込んだ画像の行（before があれば1つ下）の、さらに次
    at: { index: at.index + (before ? 1 : 0) + 1, offset: 0 },
    split: { index: at.index, offset, hasBefore: Boolean(before) },
    added: replacement.length - 1,
  }
}

/**
 * まとめてアップロードし、順に差し込む。
 *
 * **位置は呼ばれた時点で決める。**アップロードは何秒かかかるので、その間に
 * カーソルが動いても（別の行を触る・フォーカスが外れる）、貼った・落とした
 * ときの位置へ入るようにする。ボタン操作やドラッグでフォーカスが外れている
 * ときは、外れる直前に控えた位置（`lastCaret`）を使う。
 *
 * 複数枚のときは、1枚目を入れた次の行から順に並べる。
 *
 * 差し込んだ後は**編集を続けられるようにする**。落とす・貼るのは書いている
 * 途中の操作なので、画像が入るたびに編集から降ろされると、続きを書くのに
 * もう一度行を選び直すことになる。カーソルは画像の次（カーソルより後ろが
 * あればその文字の頭）へ置く。
 */
async function uploadAll(files: File[], at: CaretPosition | null = caretNow()) {
  lastCaret = null

  let position = at
  let lines = rawLines.value
  /** 上げている間も書き続けていたか。書いていたなら、その手元へは触らない。 */
  let typedMeanwhile = false

  for (const file of files) {
    const path = await images.upload(file)
    if (!path) continue

    /*
     * 上げ終わった時点で、書いている人がどこにいるか。
     *
     * 貼った位置から動いていれば、その間も書き続けているということ。
     * そこでカーソルを画像の次へ移すと、打っている最中に行頭へ飛ばされる。
     */
    const typing = activeIndex.value === null ? null : caretNow()
    const moved =
      typing !== null &&
      (position === null ||
        typing.index !== position.index ||
        typing.offset !== position.offset)

    const inserted = insertImageAt(path, position)
    lines = inserted.lines
    position = inserted.at

    if (!moved || !typing) continue

    typedMeanwhile = true
    const next = inserted.split
      ? caretAfterSplit(typing, inserted.split, inserted.added)
      : typing

    if (inserted.split && typing.index === inserted.split.index) {
      /*
       * 書いている行そのものを割った。入力欄の中身が変わるので、
       * 割れた先の同じ文字のところへ入り直す。
       */
      await activate(next.index, next.offset, lines)
      continue
    }

    /*
     * 別の行に入っただけ。増えた行数のぶん番号をずらすだけにして、
     * 入力欄には触らない（触ると変換中の文字まで確定してしまう）。
     */
    activeIndex.value = next.index
  }

  // 書き続けていた人の手元は、そのままにしておく
  if (typedMeanwhile) return

  // 位置が分からないまま入れた（末尾に足した）ときは、戻る場所が無いので降りる
  if (!at || !position) {
    deactivate()
    return
  }

  await resumeEditing(position, lines)
}

/**
 * 画像を差し込んだ後の位置から編集を続ける。
 *
 * 画像が末尾に入って続きの行が無いときは、書き続けられるよう空行を足して
 * そこへ移る。画像の行そのものへ戻すと、記法（`[URL]`）が生のまま出てきて、
 * そのまま打つと画像の行に文字が混ざる。
 */
async function resumeEditing(at: CaretPosition, lines: string[]) {
  let next = lines
  if (at.index >= next.length) {
    next = [...next, '']
    commit(next)
  }
  await activate(at.index, at.offset, next)
}

// --- 他のタスクへのリンク（ドラッグ＆ドロップ） ---------------------------
//
// 日記の「この日にやったこと」などから Item をドラッグすると、開かずに
// 本文へリンクを差し込める（docs/11-scrapbox-notation.md
// 「アプリ内のページへのリンク」）。画像と違い行を割らない。
// 「カーソル位置に挿入する」操作なので、テキストカーソルのある場所へ
// そのままはめ込む。編集中の行が無ければ、画像と同じく末尾に足す。

async function insertItemLink(payload: ItemDragPayload) {
  const link = `[/items/${payload.id} ${payload.title}]`

  /*
   * ドラッグの開始でフォーカスが外れ、drop の時点では activeIndex が
   * すでに null になっている（deactivate 済み）。その場合は、外れる直前に
   * 控えた位置（lastCaret）へ一度戻ってから差し込む。
   */
  if (activeIndex.value === null && lastCaret) {
    await activate(lastCaret.index, lastCaret.offset)
  }
  lastCaret = null

  const el = input.value
  if (activeIndex.value !== null && el) {
    const start = el.selectionStart ?? activeText.value.length
    const end = el.selectionEnd ?? start
    const value = activeText.value
    replaceActiveLine(value.slice(0, start) + link + value.slice(end))
    const caret = start + link.length
    void setCaret(caret, caret)
    return
  }

  // 一度も編集していなければ、カーソル位置が無いので画像と同じく末尾に足す
  const lines = [...rawLines.value]
  const replaceEmpty = lines.length === 1 && lines[0] === ''
  if (replaceEmpty) lines.splice(0, 1, link)
  else lines.splice(lines.length, 0, link)
  commit(lines)
}

function onDrop(event: DragEvent) {
  // 書き込めないので、画像を上げるだけ上げてしまわないよう先に降りる
  if (locked.value) return

  const itemLink = readItemLinkDrag(event.dataTransfer)
  if (itemLink) {
    event.preventDefault()
    dragging.value = false
    void insertItemLink(itemLink)
    return
  }

  const files = images.imagesFrom(event.dataTransfer)
  dragging.value = false
  if (files.length === 0) return
  event.preventDefault()
  void uploadAll(files)
}

function onDragOver(event: DragEvent) {
  // 落とせないので、落とせるようには見せない
  if (locked.value) return

  // 画像・タスクのリンクを落とせる場所であることをブラウザに伝える
  const dataTransfer = event.dataTransfer
  if (!dataTransfer?.types.includes('Files') && !isItemLinkDrag(dataTransfer)) return
  event.preventDefault()
  dragging.value = true
}

function onPaste(event: ClipboardEvent) {
  if (locked.value) return

  const files = images.imagesFrom(event.clipboardData)
  if (files.length > 0) {
    event.preventDefault()
    void uploadAll(files)
    return
  }

  /*
   * 行を選んでいる間の貼り付け（`Cmd`/`Ctrl`+`V`）。選んだ行を、貼り付けた
   * 内容で置き換える。1行を編集している間は入力欄が受け取るので、ここは
   * 行を選んでいるときだけ。
   */
  const selection = currentSelection()
  const text = event.clipboardData?.getData('text/plain')
  if (!selection || !text) return

  event.preventDefault()
  const { lines, caret } = replaceSelection(selection, lineTexts(), text)

  lineSelection = null
  window.getSelection()?.removeAllRanges()

  commit(lines)
  void activate(caret.line, caret.column, lines)
}

function onPick(event: Event) {
  const input = event.target as HTMLInputElement
  void uploadAll([...(input.files ?? [])])
  // 同じ画像をもう一度選べるようにしておく
  input.value = ''
}

defineExpose({
  focus: () => activate(rawLines.value.length - 1),
})
</script>

<template>
  <div
    ref="editorRoot"
    class="editor"
    :class="{ 'editor--dragging': dragging, 'editor--view': view }"
    :aria-label="props.ariaLabel"
    tabindex="-1"
    v-bind="keyboardSurface"
    @dragover="onDragOver"
    @dragleave="dragging = false"
    @drop="onDrop"
    @paste="onPaste"
    @copy="onCopy"
    @cut="onCut"
    @keydown="onContainerKeydown"
    @mousedown="onContainerMousedown"
  >
    <button
      v-if="isEmpty && activeIndex === null && !locked"
      type="button"
      class="editor__start"
      @click="activate(0)"
    >
      {{ props.placeholder || '本文を書く' }}
    </button>

    <template v-else>
      <!--
        入力欄は1つだけ置き、flex の order で編集中の行の位置へ動かす。
        行ごとに作り直すと、Enter の直後にフォーカスが外れてしまう。

        外枠は表示側の行と同じクラス・同じ字下げにする。行頭は入力欄に
        入れず余白で表すため、両者が揃っていないと文字の開始位置がずれる。
      -->
      <div
        v-show="activeIndex !== null"
        class="editor__editing"
        :class="activeLine ? lineClass(activeLine) : ''"
        :style="{ order: activeIndex ?? 0, '--sb-indent': activeLine?.indent ?? 0 }"
        :data-line-index="activeIndex ?? undefined"
      >
        <textarea
          ref="input"
          class="editor__input"
          rows="1"
          :value="activeText"
          :aria-label="`${props.ariaLabel} ${(activeIndex ?? 0) + 1}行目`"
          @input="onInput"
          @blur="deactivate"
          @compositionstart="composing = true"
          @compositionend="composing = false"
          @keydown="onKeydown"
          @keyup.left="updateEmojiTrigger"
          @keyup.right="updateEmojiTrigger"
          @keyup.home="updateEmojiTrigger"
          @keyup.end="updateEmojiTrigger"
          @click="updateEmojiTrigger"
        />

        <!--
          絵文字候補（Notion に倣い `:` で出す）。押すときは mousedown を
          preventDefault し、textarea の blur（＝行の編集解除）より前に
          selectEmoji を確定させる。
        -->
        <ul v-if="emojiStart !== null" class="editor__emoji" role="listbox" aria-label="絵文字・アイコンの候補">
          <li
            v-for="(entry, i) in emojiMatches"
            :key="entry.name"
            class="editor__emoji-item"
            :class="{ 'editor__emoji-item--active': i === emojiIndex }"
            role="option"
            :aria-selected="i === emojiIndex"
            @mousedown.prevent="selectEmoji(entry)"
          >
            <img
              v-if="entry.kind === 'icon'"
              class="editor__emoji-icon"
              :src="entry.path"
              alt=""
              loading="lazy"
            />
            <span v-else class="editor__emoji-char" aria-hidden="true">{{ entry.char }}</span>
            <span class="editor__emoji-name">:{{ entry.name }}:</span>
          </li>
          <li v-if="!emojiMatches.length" class="editor__emoji-empty">
            該当する絵文字・アイコンがありません
          </li>
        </ul>
      </div>

      <!--
        renderLine は入力を全てエスケープしてから組み立てるため、
        ここで v-html を使ってよい（docs/11-scrapbox-notation.md 11.10）。
      -->
      <div
        v-for="(line, index) in parsed"
        v-show="index !== activeIndex"
        :key="index"
        :class="lineClass(line)"
        :style="{ order: index, '--sb-indent': line.indent }"
        :data-line-index="index"
        @click="onLineClick($event, index)"
      >
        <span v-html="renderLine(line, { icons: iconMap })" />

        <!--
          コードブロックの中身をまとめてコピーする。読むだけの見た目の
          ときに要るもの（書いている最中は入力欄が出ている）なので、
          見出しの行に置く。
        -->
        <button
          v-if="line.type === 'codeHeader'"
          type="button"
          class="editor__copy-code"
          :aria-label="`${line.content || 'コードブロック'} の中身をコピー`"
          @click.stop="copyCode(index)"
        >
          {{ copiedCode === index ? 'コピーしました' : 'コピー' }}
        </button>
      </div>
    </template>

    <!--
      画像の追加。PC はドラッグ&ドロップと貼り付けで足りるが、
      スマートフォンにはどちらもないのでボタンを置く。
      order で常に末尾に置く（行は order で並べているため）。
    -->
    <footer v-if="!view" class="editor__foot">
      <!--
        読むだけの間も置いたままにする（隠すと、編集できるようになった
        ときにこの行の分だけ下がってしまう）。押せないことだけを伝える。
      -->
      <button
        type="button"
        class="editor__image"
        :disabled="locked || images.uploading.value > 0"
        @click="filePicker?.click()"
      >
        {{ images.uploading.value > 0 ? '画像を追加中…' : '画像を追加' }}
      </button>
      <span v-if="images.errorMessage.value" class="editor__error" role="alert">
        {{ images.errorMessage.value }}
      </span>
      <input
        ref="filePicker"
        class="editor__picker"
        type="file"
        accept="image/*"
        multiple
        @change="onPick"
      />
    </footer>
  </div>
</template>

<style scoped>
.editor {
  /* 行の並べ替えに order を使うので flex にする */
  display: flex;
  flex-direction: column;
  /*
   * 親より広くならないようにする。
   *
   * 中の textarea は既定で 20 文字ぶんの固有幅を持ち、これが縮まないと
   * この枠ごと画面より広くなる。狭い端末や文字を大きくした端末では、
   * それだけでページが横スクロールし、少し縮小して表示される。
   */
  min-width: 0;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 0.75rem;
  min-height: 9rem;
  line-height: 1.7;
  cursor: text;
  overflow-wrap: anywhere;

  /*
   * 字下げ1段ぶんの幅。行の階層はどこでもこれを単位にする。
   * コードブロックの中も外と同じ単位で下げないと、同じ階層のはずの行が
   * ブロックの内と外で違う位置から始まってしまう。
   */
  --sb-step: 1.25rem;
  /*
   * コードブロックの枠を、文字より左へ出す幅。
   *
   * 見出し（`code:` のファイル名）が枠線に貼り付かないよう、文字を右へ
   * 動かすのではなく枠のほうを広げる。文字を動かすと、ブロックの外の
   * 同じ階層と開始位置がずれる。
   */
  --sb-code-bleed: 0.5rem;
}

/*
 * 複数行選択の間、Shift+矢印の続きを拾うために .editor 自身へ
 * フォーカスを移す（tabindex="-1"）。選択自体がブラウザの標準ハイライトで
 * 見えるので、枠線は不要。
 */
.editor:focus {
  outline: none;
}

/*
 * 確定済みの表示。入力欄に見えないよう囲みを外し、高さは中身に任せる
 * （docs/03-functional-spec.md 3.2）。記法の見た目はそのまま。
 */
.editor--view {
  background: transparent;
  border-color: transparent;
  border-radius: 0;
  padding: 0;
  min-height: 0;
  cursor: default;
}

/* 画像を落とせる場所であることを示す */
.editor--dragging {
  border-color: var(--accent);
  background: color-mix(in srgb, var(--accent) 6%, var(--surface));
}

.editor__start {
  background: transparent;
  border: 0;
  padding: 0;
  color: var(--text-muted);
  font: inherit;
  text-align: left;
  cursor: text;
}

.editor__editing {
  position: relative;
}

.editor__emoji {
  position: absolute;
  top: 100%;
  left: 0;
  z-index: 20;
  margin: 0.25rem 0 0;
  padding: 0.25rem;
  list-style: none;
  min-width: 10rem;
  max-height: 12rem;
  overflow-y: auto;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 8px;
  box-shadow: var(--shadow);
}

.editor__emoji-item {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.25rem 0.5rem;
  border-radius: 6px;
  font-size: 0.875rem;
  white-space: nowrap;
  cursor: pointer;
}

.editor__emoji-item--active {
  background: color-mix(in srgb, var(--accent) 14%, transparent);
}

.editor__emoji-char {
  font-size: 1.125rem;
  line-height: 1;
}

/* 登録したアイコン。絵文字1文字と同じ大きさに収める */
.editor__emoji-icon {
  width: 1.25rem;
  height: 1.25rem;
  object-fit: contain;
}

.editor__emoji-name {
  color: var(--text-muted);
}

.editor__emoji-empty {
  padding: 0.25rem 0.5rem;
  color: var(--text-muted);
  font-size: 0.8125rem;
}

.editor__foot {
  /* 行は order で並べるので、足元は必ず最後に来るよう大きな値を置く */
  order: 9999;
  display: flex;
  align-items: center;
  gap: 0.5rem;
  /* margin-top: auto だと本文が短いときに1行を超えて余白が広がるため、固定値にする */
  margin-top: 0.5rem;
}

.editor__image {
  background: transparent;
  border: 0;
  padding: 0;
  color: var(--text-muted);
  font-size: 0.75rem;
  cursor: pointer;
}

.editor__image:disabled {
  opacity: 0.6;
  cursor: default;
}

.editor__error {
  color: var(--danger);
  font-size: 0.75rem;
}

.editor__picker {
  display: none;
}

.editor__input {
  font: inherit;
  width: 100%;
  /* 20 文字ぶんの固有幅（cols の既定）で枠を押し広げさせない */
  min-width: 0;
  display: block;
  resize: none;
  overflow: hidden;
  /* 編集中の行だけ、記法がそのまま見えていると分かるようにする。
     色を付けるのは入力欄そのもの。行頭の余白まで塗ると、
     どこから書き換えられるのかが分からなくなる */
  background: color-mix(in srgb, var(--accent) 7%, transparent);
  border-radius: 4px;
  color: inherit;
  border: 0;
  outline: none;
  padding: 0;
  line-height: inherit;
  tab-size: 2;
}

/*
 * 編集中も、表示と同じ字送りにする。
 * 文字の幅が変わると、カーソルを置いた行だけ見た目が動いてしまう。
 * （引用の色は外枠から `color: inherit` で受け取る）
 */
.editor__editing.sb-line--code-header .editor__input {
  font-size: 0.75rem;
  color: var(--text-muted);
}

.editor__editing.sb-line--code-body .editor__input {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 0.875rem;
}

/* --- Scrapbox 記法の見た目 --- */

.editor :deep(.sb-line) {
  /* 字下げ1段ぶん。行頭の空白の数がそのまま階層になる */
  padding-left: calc(var(--sb-indent, 0) * var(--sb-step));
  position: relative;
  min-height: 1.7em;
  /* 入力欄と同じように空白を残す。詰めると、その行だけ文字の位置がずれる */
  white-space: pre-wrap;
}

/* 字下げされた行は箇条書きとして中黒を出す */
.editor :deep(.sb-line--indented)::before {
  content: '';
  position: absolute;
  left: calc(var(--sb-indent, 0) * var(--sb-step) - 0.75rem);
  top: 0.75em;
  width: 0.3125rem;
  height: 0.3125rem;
  border-radius: 50%;
  background: var(--text-muted);
}

/*
 * `----`（ハイフン4つ以上）の行は区切りの罫線として出す。
 *
 * 線だけを描き、文字ぶんの高さ（`.sb-line` の min-height）はそのまま使う。
 * 行の高さを変えないので、カーソルを置いて元の `----` を直しても
 * 前後の行が動かない。
 */
.editor :deep(.sb-rule) {
  display: block;
  width: 100%;
  height: 0;
  border: 0;
  border-top: 1px solid var(--border);
  /* 文字の行と同じ高さの中で、線が上下の真ん中に来るようにする */
  margin: 0.8em 0 0;
}

/* 線だけの行なので、字下げしていても箇条書きの中黒は出さない */
.editor :deep(.sb-line--rule)::before {
  content: none;
}

/*
 * 引用・コードブロックはリストに埋め込まれても、箱ごとリストの内側から
 * 表示する（Scrapbox と同じ）。文字だけを padding で詰めると、枠線や
 * 背景がリストの外まで広がって、入れ子になって見えなくなるため、
 * 箱そのものを margin で字下げの分だけ右へ寄せる
 */
.editor :deep(.sb-line--quote) {
  margin-left: calc(var(--sb-indent, 0) * var(--sb-step));
  border-left: 3px solid var(--border);
  padding-left: 0.625rem;
  color: var(--text-muted);
}

/*
 * コードブロックは行が連なって1つの箱に見えるようにする。
 *
 * 箱は文字より `--sb-code-bleed` だけ左へ出し、そのぶんを padding で戻す。
 * こうすると**文字の開始位置は変えないまま**、見出しの左に枠線との余白ができる。
 *
 * 枠線（1px）ぶんも足して出す。枠の内側から文字までがちょうど
 * `--sb-code-bleed` になり、文字はブロックの外の同じ階層と同じ位置に並ぶ。
 */
.editor :deep(.sb-line--code-header),
.editor :deep(.sb-line--code-body) {
  margin-left: calc(
    var(--sb-indent, 0) * var(--sb-step) - var(--sb-code-bleed) - 1px
  );
  padding-left: var(--sb-code-bleed);
  background: var(--bg);
  border-left: 1px solid var(--border);
  border-right: 1px solid var(--border);
}

/*
 * 字下げしたブロックでは、枠を出す幅（`--sb-code-bleed`）を詰める。
 *
 * 既定（0.5rem）のままだと、枠線がちょうど箇条書きの中黒（文字より 7〜12px
 * 左）の上を通る。**中黒と見出しの文字のどちらにも触れない**よう、その間へ
 * 収める（文字より 3〜4px 左）。
 *
 * 中黒のほうは動かさない。同じ階層の行で中黒の位置がずれると、どこまでが
 * 同じ深さなのかを目で追えなくなるため。margin と padding は同じ変数から
 * 作っているので、ここを変えても**文字の開始位置は変わらない**。
 */
.editor :deep(.sb-line--code-header.sb-line--indented),
.editor :deep(.sb-line--code-body.sb-line--indented) {
  --sb-code-bleed: 0.1875rem;
}

/*
 * 中身の行は `code:` の行から**1段下げる**（Scrapbox と同じ）。
 *
 * ブロックの続きであることは本文でも行頭の空白1つで表していて、その空白は
 * 実際に入っている。行頭は文字として入力欄に入れず余白で見せる決まり
 * （docs/11-scrapbox-notation.md 11.6）なので、その1段ぶんをここで空ける。
 *
 * 下げ幅は**ブロックの外と同じ1段**（`--sb-step`）。同じ階層のはずの行が、
 * コードブロックの内と外で違う位置から始まると、階層を目で追えなくなる。
 * 基準より深い字下げはコードの一部として中身に残り、そのぶんはさらに右へ出る。
 */
.editor :deep(.sb-line--code-body) {
  padding-left: calc(var(--sb-code-bleed) + var(--sb-step));
}

.editor :deep(.sb-line--code-header) {
  border-top: 1px solid var(--border);
  border-top-left-radius: 6px;
  border-top-right-radius: 6px;
}

.editor :deep(.sb-line--code-last) {
  border-bottom: 1px solid var(--border);
  border-bottom-left-radius: 6px;
  border-bottom-right-radius: 6px;
}

/* 中身の行は見出しにぶら下がる続きなので、中黒は出さない */
.editor :deep(.sb-line--code-body)::before {
  content: none;
}

/*
 * 見出し行はリストの1項目として中黒を出す。箱自体が margin で字下げの分だけ
 * 寄っている（さらに --sb-code-bleed ぶん左へ出ている）ので、中黒の位置も
 * そこからの相対値に直す
 */
.editor :deep(.sb-line--code-header.sb-line--indented)::before {
  left: calc(var(--sb-code-bleed) - 0.75rem);
}

/*
 * コードブロックのコピー。見出しの右端に、控えめに置く。
 * 触れるものだと分かる程度にはっきりさせつつ、読む邪魔をしない。
 */
.editor__copy-code {
  position: absolute;
  top: 0.125rem;
  right: 0.375rem;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 6px;
  color: var(--text-muted);
  font-size: 0.6875rem;
  line-height: 1.6;
  padding: 0 0.375rem;
  cursor: pointer;
}

.editor__copy-code:hover {
  color: var(--text);
}

.editor :deep(.sb-line--code-header) {
  position: relative;
  /* コピーのボタンと重ならないだけの余白を、見出しの右に取る */
  padding-right: 5rem;
}

.editor :deep(.sb-code__name) {
  color: var(--text-muted);
  font-size: 0.75rem;
}

.editor :deep(.sb-code__text) {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 0.875rem;
  white-space: pre;
}

/*
 * Scrapbox に見出し記法はなく、`*` の数で文字が大きく・太くなる。
 * `[/ 斜体]` や `[- 打ち消し]` は太字にしない。
 */
.editor :deep([class*='sb-deco--level']) {
  font-weight: 700;
}

.editor :deep(.sb-deco--level1) {
  font-size: 1.05em;
}
.editor :deep(.sb-deco--level2) {
  font-size: 1.2em;
}
.editor :deep(.sb-deco--level3) {
  font-size: 1.4em;
}
.editor :deep(.sb-deco--level4) {
  font-size: 1.6em;
}
.editor :deep(.sb-deco--level5) {
  font-size: 1.8em;
}
.editor :deep(.sb-deco--level6) {
  font-size: 2em;
}

.editor :deep(.sb-deco--italic) {
  font-style: italic;
}
.editor :deep(.sb-deco--strike) {
  text-decoration: line-through;
}
.editor :deep(.sb-deco--underline) {
  text-decoration: underline;
}

.editor :deep(.sb-link) {
  color: var(--accent);
}

/* 日記・タスクへのアプリ内リンク。外部リンクと見分けられるよう、ページリンクと同じ見た目にする */
.editor :deep(.sb-link--internal),
.editor :deep(.sb-page-link) {
  color: var(--accent);
  border-bottom: 1px dotted currentcolor;
}

.editor :deep(.sb-hashtag) {
  color: var(--accent);
}

.editor :deep(.sb-code-inline) {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 0.9em;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 4px;
  padding: 0.0625rem 0.25rem;
}

.editor :deep(.sb-image) {
  max-width: 100%;
  /* 押すと拡大する（onLineClick）。押せることが分かるようにする */
  cursor: zoom-in;
  /* 縦長の画像が場所を取りすぎないよう、高さで頭打ちにする。
     幅・高さのどちらも指定しないことで、img 本来の縦横比を保ったまま
     縮む（全体が見える。切り取りはしない） */
  max-height: 300px;
}

.editor :deep(.sb-image--large) {
  width: 100%;
  /* `[[画像URL]]` は「横幅いっぱいで出す」記法なので、高さの頭打ち
     （.sb-image の max-height）は外す。幅を決めたまま高さだけ縮めると、
     縦横比が変わって潰れて見えるため。縦長の画像は 300px を超えて伸びる */
  height: auto;
  max-height: none;
}

/*
 * 自分で登録したアイコン（`:name:`）。
 *
 * 文字の一部として文中に置くものなので、行の高さに収める。em で持たせて、
 * 見出し（`[* ]`）の中では文字と一緒に大きくなるようにする。
 */
.editor :deep(.sb-icon) {
  height: 1.25em;
  width: auto;
  max-height: none;
  vertical-align: -0.25em;
  object-fit: contain;
}
</style>
