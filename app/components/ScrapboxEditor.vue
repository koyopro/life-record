<script setup lang="ts">
import { lineClass, renderLine } from '~~/shared/utils/scrapbox/render'
import { parseScrapbox } from '~~/shared/utils/scrapbox/parse'

/**
 * Scrapbox 記法の本文エディタ（docs/11-scrapbox-notation.md 11.6）。
 *
 * Scrapbox と同じく **行単位** で表示を切り替える。
 * - カーソルのある行 … 記法をそのままのテキストとして編集する
 * - それ以外の行     … 記法を解釈した表示
 *
 * 保存されるのは常に入力したままのテキスト。
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
const activeText = ref('')
/**
 * 編集中の行の入力欄。
 *
 * `v-for` の中に置いた `ref` は配列になるため、関数 ref で直接受け取る。
 */
const input = ref<HTMLTextAreaElement | null>(null)
function setInput(el: unknown) {
  input.value = el instanceof HTMLTextAreaElement ? el : null
}

const isEmpty = computed(() => !model.value.trim())

function commit(lines: string[]) {
  model.value = lines.join('\n')
}

async function activate(index: number, caret: 'start' | 'end' | number = 'end') {
  const lines = rawLines.value
  const target = Math.min(Math.max(index, 0), lines.length - 1)
  activeIndex.value = target
  activeText.value = lines[target] ?? ''

  await nextTick()
  const el = input.value
  if (!el) return
  el.focus()
  const position =
    caret === 'end' ? el.value.length : caret === 'start' ? 0 : caret
  el.setSelectionRange(position, position)
  resize()
}

function deactivate() {
  activeIndex.value = null
}

/** 入力中の行を model に反映する。 */
function onInput() {
  const index = activeIndex.value
  if (index === null) return
  const lines = [...rawLines.value]

  // 貼り付けで改行が入ることがあるので、その場合は行を分ける
  if (activeText.value.includes('\n')) {
    const inserted = activeText.value.split('\n')
    lines.splice(index, 1, ...inserted)
    commit(lines)
    void activate(index + inserted.length - 1)
    return
  }

  lines[index] = activeText.value
  commit(lines)
  resize()
}

/** 折り返しに合わせて高さを合わせる。 */
function resize() {
  const el = input.value
  if (!el) return
  el.style.height = 'auto'
  el.style.height = `${el.scrollHeight}px`
}

// --- キー操作 -----------------------------------------------------------
//
// 日本語入力の変換中は Enter などを横取りしない。変換の確定が
// 行の分割として扱われてしまうため。

const composing = ref(false)

function onEnter(event: KeyboardEvent) {
  if (composing.value) return
  event.preventDefault()

  const index = activeIndex.value
  const el = input.value
  if (index === null || !el) return

  const caret = el.selectionStart ?? activeText.value.length
  const before = activeText.value.slice(0, caret)
  const after = activeText.value.slice(caret)

  // Scrapbox と同じく、改行したら前の行の字下げを引き継ぐ
  const indent = /^[ \t]*/.exec(before)?.[0] ?? ''

  const lines = [...rawLines.value]
  lines.splice(index, 1, before, indent + after)
  commit(lines)
  void activate(index + 1, indent.length)
}

function onBackspace(event: KeyboardEvent) {
  const index = activeIndex.value
  const el = input.value
  if (index === null || !el) return
  if (el.selectionStart !== 0 || el.selectionEnd !== 0) return
  if (index === 0) return

  event.preventDefault()
  const lines = [...rawLines.value]
  const previous = lines[index - 1] ?? ''
  lines.splice(index - 1, 2, previous + activeText.value)
  commit(lines)
  void activate(index - 1, previous.length)
}

function onArrow(event: KeyboardEvent, delta: -1 | 1) {
  const index = activeIndex.value
  const el = input.value
  if (index === null || !el) return

  // 行内を移動できるうちは、行をまたがない
  if (delta === -1 && el.selectionStart !== 0) return
  if (delta === 1 && el.selectionStart !== el.value.length) return

  const next = index + delta
  if (next < 0 || next >= rawLines.value.length) return

  event.preventDefault()
  void activate(next, delta === -1 ? 'end' : 'start')
}

/** 字下げを1段変える。Scrapbox では字下げが箇条書きの階層になる。 */
function onTab(event: KeyboardEvent) {
  const index = activeIndex.value
  if (index === null) return
  event.preventDefault()

  const caret = input.value?.selectionStart ?? 0

  if (event.shiftKey) {
    if (!/^[ \t]/.test(activeText.value)) return
    activeText.value = activeText.value.slice(1)
    onInput()
    void activate(index, Math.max(caret - 1, 0))
    return
  }

  activeText.value = ` ${activeText.value}`
  onInput()
  void activate(index, caret + 1)
}

/** 表示側のリンクを押したときは編集に切り替えない。 */
function onLineClick(event: MouseEvent, index: number) {
  const target = event.target as HTMLElement | null
  if (target?.closest('a')) return
  void activate(index)
}

// 外から本文が入れ替わったとき（別画面での更新など）は編集を解除する
watch(model, () => {
  if (activeIndex.value === null) return
  if (rawLines.value[activeIndex.value] !== activeText.value) deactivate()
})

defineExpose({
  focus: () => activate(rawLines.value.length - 1),
})
</script>

<template>
  <div class="editor" :aria-label="props.ariaLabel">
    <button
      v-if="isEmpty && activeIndex === null"
      type="button"
      class="editor__start"
      @click="activate(0)"
    >
      {{ props.placeholder || '本文を書く' }}
    </button>

    <template v-else>
      <template v-for="(line, index) in parsed" :key="index">
        <!-- カーソルのある行は、記法をそのままのテキストとして編集する -->
        <div v-if="index === activeIndex" class="editor__editing">
          <textarea
            :ref="setInput"
            v-model="activeText"
            class="editor__input"
            rows="1"
            :aria-label="`${props.ariaLabel} ${index + 1}行目`"
            @input="onInput"
            @blur="deactivate"
            @compositionstart="composing = true"
            @compositionend="composing = false"
            @keydown.enter="onEnter"
            @keydown.backspace="onBackspace"
            @keydown.up="onArrow($event, -1)"
            @keydown.down="onArrow($event, 1)"
            @keydown.tab="onTab"
            @keydown.esc.prevent="deactivate"
          />
        </div>

        <!--
          renderLine は入力を全てエスケープしてから組み立てるため、
          ここで v-html を使ってよい（docs/11-scrapbox-notation.md 11.9）。
        -->
        <div
          v-else
          :class="lineClass(line)"
          :style="{ '--sb-indent': line.indent }"
          @click="onLineClick($event, index)"
          v-html="renderLine(line)"
        />
      </template>
    </template>
  </div>
</template>

<style scoped>
.editor {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 0.75rem;
  min-height: 9rem;
  line-height: 1.7;
  cursor: text;
  overflow-wrap: anywhere;
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
  /* 編集中の行だけ、記法がそのまま見えていると分かるようにする */
  background: color-mix(in srgb, var(--accent) 7%, transparent);
  border-radius: 4px;
}

.editor__input {
  font: inherit;
  width: 100%;
  display: block;
  resize: none;
  overflow: hidden;
  background: transparent;
  color: var(--text);
  border: 0;
  outline: none;
  padding: 0;
  line-height: inherit;
  tab-size: 2;
}

/* --- Scrapbox 記法の見た目 --- */

.editor :deep(.sb-line) {
  /* 字下げ1段ぶん。行頭の空白の数がそのまま階層になる */
  padding-left: calc(var(--sb-indent, 0) * 1.25rem);
  position: relative;
  min-height: 1.7em;
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

.editor :deep(.sb-line--quote) {
  border-left: 3px solid var(--border);
  padding-left: calc(var(--sb-indent, 0) * 1.25rem + 0.625rem);
  color: var(--text-muted);
}

/* コードブロックは行が連なって1つの箱に見えるようにする */
.editor :deep(.sb-line--code-header),
.editor :deep(.sb-line--code-body) {
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

.editor :deep(.sb-line--code-header)::before,
.editor :deep(.sb-line--code-body)::before {
  content: none;
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
