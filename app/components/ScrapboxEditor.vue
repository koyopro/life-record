<script setup lang="ts">
import { lineClass, renderLine } from '~~/shared/utils/scrapbox/render'
import { dropPrefixUnit, indentOf, parseScrapbox } from '~~/shared/utils/scrapbox/parse'
import type { Line } from '~~/shared/utils/scrapbox/types'
import { searchEmoji, type EmojiEntry } from '~~/shared/utils/emoji'
import { toAppDate } from '~~/shared/utils/date'
import { isItemLinkDrag, readItemLinkDrag, type ItemDragPayload } from '~/utils/item-drag'

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
  }>(),
  { placeholder: '', ariaLabel: '本文' },
)

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

const isEmpty = computed(() => !model.value.trim())

function commit(lines: string[]) {
  model.value = lines.join('\n')
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

/** 直前まで編集していた位置。フォーカスが外れたときに、その位置を覚えておく。 */
let lastCaret: { index: number; offset: number } | null = null

/**
 * 上下キーで行をまたぐときに保つ横位置（行頭からの文字数）。
 *
 * 行ごとに別の textarea なので、ブラウザが自前で持つ「上下移動中の
 * 横位置」の記憶は行をまたいだ時点で失われる。それを肩代わりする。
 * 上下キー以外での移動（クリック・タイプ・左右キーなど）では null に戻し、
 * 次に上下キーを押したときの実際のカーソル位置を使い直す。
 */
let desiredColumn: number | null = null

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

  if (event?.target instanceof HTMLTextAreaElement) {
    activeText.value = event.target.value
  }

  const lines = [...rawLines.value]
  const prefix = activePrefix.value

  // 貼り付けで改行が入ることがあるので、その場合は行を分ける
  if (activeText.value.includes('\n')) {
    closeEmojiPicker()
    const inserted = `${prefix}${activeText.value}`.split('\n')
    lines.splice(index, 1, ...inserted)
    commit(lines)
    void activate(index + inserted.length - 1, 'end', lines)
    return
  }

  lines[index] = prefix + activeText.value
  commit(lines)
  // 変換中は行頭を取り直さない。入力欄の値やキャレットを触ると変換が壊れる
  if (!composing.value) syncPrefix(lines, index, prefix)
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

const emojiMatches = computed<EmojiEntry[]>(() =>
  emojiStart.value === null ? [] : searchEmoji(emojiQuery.value),
)

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

/** 候補を選び、`:` からキャレットまでを絵文字に置き換える。 */
function selectEmoji(entry: EmojiEntry) {
  const start = emojiStart.value
  const el = input.value
  if (start === null || !el) return

  const caret = el.selectionStart ?? activeText.value.length
  const value = activeText.value
  const next = value.slice(0, start) + entry.char + value.slice(caret)
  replaceActiveLine(next)

  const newCaret = start + entry.char.length
  void setCaret(newCaret, newCaret)
  closeEmojiPicker()
}

// --- キー操作 -----------------------------------------------------------
//
// 日本語入力の変換中は Enter などを横取りしない。変換の確定が
// 行の分割として扱われてしまうため。

const composing = ref(false)

/**
 * キー操作の入り口。
 *
 * Vue のキー修飾子は使わない。`.delete` が Backspace の別名になっている等、
 * 名前と実際のキーが一致しない箇所があり、取り違えると事故になるため、
 * `event.key` を直接見る。
 */
function onKeydown(event: KeyboardEvent) {
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
    case 'k':
      // macOS の Ctrl+K は「カーソルより後ろを行末まで消す」(Emacs 由来)。
      // 空行なら消す文字がなく、そこにあるのは改行なので Ctrl+D と同じ扱いにする
      if (event.ctrlKey && activeText.value === '') return onForwardDelete(event)
      return
    case 't':
      if (event.ctrlKey) return insertToday(event)
      return
  }
}

/**
 * `[` を打ったら `]` も添える。カーソルは `[` の直後に置く。
 *
 * Scrapbox の記法はほぼ角括弧なので、閉じ忘れを防ぐ。
 * 選択範囲があるときは、それを囲んで選択を保つ。
 */
function onOpenBracket(event: KeyboardEvent) {
  if (composing.value) return
  const el = input.value
  if (activeIndex.value === null || !el) return

  event.preventDefault()

  const start = el.selectionStart ?? 0
  const end = el.selectionEnd ?? start
  const value = activeText.value
  const selected = value.slice(start, end)

  replaceActiveLine(`${value.slice(0, start)}[${selected}]${value.slice(end)}`)
  void setCaret(start + 1, start + 1 + selected.length)
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
  if (composing.value) return
  event.preventDefault()

  const index = activeIndex.value
  const el = input.value
  if (index === null || !el) return

  const caret = el.selectionStart ?? activeText.value.length
  const before = activeText.value.slice(0, caret)
  const after = activeText.value.slice(caret)

  // Scrapbox と同じく、改行したら前の行の字下げを引き継ぐ。
  // 引用の `>` も引き継ぐ（複数行の引用は各行に `>` を書く記法のため）。
  // `code:` だけは、続きの行がもう1つのコードブロックにならないよう落とす。
  const prefix = activePrefix.value
  const strippedPrefix = prefix.replace(/code:$/, '')
  // `code:` 行の直後は、本文と同じ基準の字下げ（+1）から始める。
  // そうしないと、空のまま Enter や Delete を押しただけでコードブロックを
  // 抜けてしまう（parse.ts の空行判定を参照）
  const nextPrefix =
    activeLine.value?.type === 'codeHeader' ? `${strippedPrefix} ` : strippedPrefix

  const lines = [...rawLines.value]
  lines.splice(index, 1, prefix + before, nextPrefix + after)
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
function isOnFirstRow(el: HTMLTextAreaElement): boolean {
  const caret = el.selectionStart ?? 0
  return wrappedHeight(el, caret) <= wrappedHeight(el, 0)
}

/** キャレットが折り返しの最後の行にあるか。 */
function isOnLastRow(el: HTMLTextAreaElement): boolean {
  const caret = el.selectionEnd ?? el.value.length
  return wrappedHeight(el, caret) >= wrappedHeight(el, el.value.length)
}

function onArrow(event: KeyboardEvent, delta: -1 | 1) {
  const index = activeIndex.value
  const el = input.value
  if (index === null || !el) return

  // 修飾キーを押していれば、カーソルではなく行そのものを動かす
  if (event.altKey) return moveBlock(event, delta)
  if (event.ctrlKey) return moveLine(event, delta)

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
 * 行を1つだけ、隣の行と入れ替える（`Ctrl`+`↑` / `↓`）。
 *
 * 字下げは動かさない。ぶら下がっている行は連れていかないので、
 * 階層をまたいで並べ替えたいときはこちらを使う。
 */
function moveLine(event: KeyboardEvent, delta: -1 | 1) {
  const index = activeIndex.value
  if (index === null || composing.value) return

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
  if (index === null || composing.value) return

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
  if (composing.value) return
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

/** 表示側のリンクを押したときは編集に切り替えない。 */
function onLineClick(event: MouseEvent, index: number) {
  const target = event.target as HTMLElement | null
  if (target?.closest('a')) return
  void activate(index)
}

/** 選択の起点・終点から、それが属する行の要素と行番号を探す。 */
function closestLine(node: Node | null): { el: Element; index: number } | null {
  const el = (node instanceof Element ? node : node?.parentElement)?.closest('[data-line-index]')
  if (!el) return null
  const index = Number(el.getAttribute('data-line-index'))
  return Number.isNaN(index) ? null : { el, index }
}

/**
 * 複数行にまたがる選択をコピーしたときは、Scrapbox と同じく記法込みの
 * 生テキストを渡す。
 *
 * 表示側は行頭（字下げ・`>` ・`code:`）を文字ではなく余白として見せている
 * ため、素直にコピーするとその部分が抜け落ちる。選択がまたぐ行の範囲だけ
 * DOM から判定し、中身はブラウザの選択文字列ではなく model の生テキスト
 * （`rawLines`）から組み立て直す。
 *
 * 1行内の部分選択（例: コードの中身の一部だけ選ぶ）は、余白を含まないため
 * ブラウザの既定のコピーのままでよい。行全体を選んでいるときだけ差し替える。
 */
function onCopy(event: ClipboardEvent) {
  const selection = window.getSelection()
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) return

  const anchor = closestLine(selection.anchorNode)
  const focus = closestLine(selection.focusNode)
  if (!anchor || !focus) return

  const start = Math.min(anchor.index, focus.index)
  const end = Math.max(anchor.index, focus.index)
  if (start === end && selection.toString().trim() !== anchor.el.textContent?.trim()) return

  const text = rawLines.value.slice(start, end + 1).join('\n')
  event.clipboardData?.setData('text/plain', text)
  event.preventDefault()
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

const images = useImageUpload()
const filePicker = ref<HTMLInputElement | null>(null)
/** 本文の上に画像が乗っているか。落とせることが分かるようにする。 */
const dragging = ref(false)

/**
 * 画像を1行として、指定した位置に差し込む。
 *
 * 行の途中に混ぜると、書きかけの文が画像記法で割られてしまうため、
 * 常に1行として入れる。挿入位置を決めるのは呼び出し側（uploadAll）。
 */
function insertImageAt(path: string, at: number) {
  const lines = [...rawLines.value]

  // 空の本文に足すときは、先頭の空行をそのまま使う
  const replaceEmpty = lines.length === 1 && lines[0] === ''
  if (replaceEmpty) lines.splice(0, 1, `[${path}]`)
  else lines.splice(at, 0, `[${path}]`)

  commit(lines)
}

/**
 * まとめてアップロードし、カーソル位置（の次の行）へ順に差し込む。
 *
 * ボタン操作やドラッグ開始でフォーカスが外れていても、外れる直前の
 * カーソル位置（lastCaret）へ一度戻ってから差し込む（insertItemLink と
 * 同じ理由）。一度も編集していなければ末尾に足す。
 *
 * 挿入位置は最初に1回だけ決め、複数枚のときはそこから1行ずつ進める。
 * 画像を入れるたびに位置を数え直すと、フォーカスが外れて末尾扱いになり
 * 2枚目以降の順序が入れ替わる。
 */
async function uploadAll(files: File[]) {
  if (activeIndex.value === null && lastCaret) {
    await activate(lastCaret.index, lastCaret.offset)
  }
  lastCaret = null

  let at = activeIndex.value === null ? rawLines.value.length : activeIndex.value + 1

  for (const file of files) {
    const path = await images.upload(file)
    if (!path) continue
    insertImageAt(path, at)
    at += 1
  }

  deactivate()
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
  // 画像・タスクのリンクを落とせる場所であることをブラウザに伝える
  const dataTransfer = event.dataTransfer
  if (!dataTransfer?.types.includes('Files') && !isItemLinkDrag(dataTransfer)) return
  event.preventDefault()
  dragging.value = true
}

function onPaste(event: ClipboardEvent) {
  const files = images.imagesFrom(event.clipboardData)
  if (files.length === 0) return
  event.preventDefault()
  void uploadAll(files)
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
    class="editor"
    :class="{ 'editor--dragging': dragging }"
    :aria-label="props.ariaLabel"
    @dragover="onDragOver"
    @dragleave="dragging = false"
    @drop="onDrop"
    @paste="onPaste"
    @copy="onCopy"
  >
    <button
      v-if="isEmpty && activeIndex === null"
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
        <ul v-if="emojiStart !== null" class="editor__emoji" role="listbox" aria-label="絵文字候補">
          <li
            v-for="(entry, i) in emojiMatches"
            :key="entry.name"
            class="editor__emoji-item"
            :class="{ 'editor__emoji-item--active': i === emojiIndex }"
            role="option"
            :aria-selected="i === emojiIndex"
            @mousedown.prevent="selectEmoji(entry)"
          >
            <span class="editor__emoji-char" aria-hidden="true">{{ entry.char }}</span>
            <span class="editor__emoji-name">:{{ entry.name }}:</span>
          </li>
          <li v-if="!emojiMatches.length" class="editor__emoji-empty">
            該当する絵文字がありません
          </li>
        </ul>
      </div>

      <!--
        renderLine は入力を全てエスケープしてから組み立てるため、
        ここで v-html を使ってよい（docs/11-scrapbox-notation.md 11.9）。
      -->
      <div
        v-for="(line, index) in parsed"
        v-show="index !== activeIndex"
        :key="index"
        :class="lineClass(line)"
        :style="{ order: index, '--sb-indent': line.indent }"
        :data-line-index="index"
        @click="onLineClick($event, index)"
        v-html="renderLine(line)"
      />
    </template>

    <!--
      画像の追加。PC はドラッグ&ドロップと貼り付けで足りるが、
      スマートフォンにはどちらもないのでボタンを置く。
      order で常に末尾に置く（行は order で並べているため）。
    -->
    <footer class="editor__foot">
      <button
        type="button"
        class="editor__image"
        :disabled="images.uploading.value > 0"
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
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 0.75rem;
  min-height: 9rem;
  line-height: 1.7;
  cursor: text;
  overflow-wrap: anywhere;
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
  padding-left: calc(var(--sb-indent, 0) * 1.25rem);
  position: relative;
  min-height: 1.7em;
  /* 入力欄と同じように空白を残す。詰めると、その行だけ文字の位置がずれる */
  white-space: pre-wrap;
}

/* 字下げされた行は箇条書きとして中黒を出す */
.editor :deep(.sb-line--indented)::before {
  content: '';
  position: absolute;
  left: calc(var(--sb-indent, 0) * 1.25rem - 0.75rem);
  top: 0.75em;
  width: 0.3125rem;
  height: 0.3125rem;
  border-radius: 50%;
  background: var(--text-muted);
}

/*
 * 引用・コードブロックはリストに埋め込まれても、箱ごとリストの内側から
 * 表示する（Scrapbox と同じ）。文字だけを padding で詰めると、枠線や
 * 背景がリストの外まで広がって、入れ子になって見えなくなるため、
 * 箱そのものを margin で字下げの分だけ右へ寄せる
 */
.editor :deep(.sb-line--quote) {
  margin-left: calc(var(--sb-indent, 0) * 1.25rem);
  border-left: 3px solid var(--border);
  padding-left: 0.625rem;
  color: var(--text-muted);
}

/* コードブロックは行が連なって1つの箱に見えるようにする */
.editor :deep(.sb-line--code-header),
.editor :deep(.sb-line--code-body) {
  margin-left: calc(var(--sb-indent, 0) * 1.25rem);
  padding-left: 0;
  background: var(--bg);
  border-left: 1px solid var(--border);
  border-right: 1px solid var(--border);
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
 * 見出し行はリストの1項目として中黒を出す。箱自体が margin で
 * 字下げの分だけ寄っているので、中黒の位置もそこからの相対値に直す
 */
.editor :deep(.sb-line--code-header.sb-line--indented)::before {
  left: -0.75rem;
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
  border-radius: 8px;
}

.editor :deep(.sb-image--large) {
  width: 100%;
}
</style>
