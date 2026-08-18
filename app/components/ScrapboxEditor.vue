<script setup lang="ts">
import { escapeHtml, renderScrapbox } from '~~/shared/utils/scrapbox/render'

/**
 * Scrapbox 記法の本文エディタ（docs/11-scrapbox-notation.md）。
 *
 * Scrapbox と同じく、**記法を含むプレーンテキストを直接編集する**。
 * 編集していない間は記法を解釈した表示にし、クリックすると元のテキストに戻る。
 * 保存されるのは常に入力したままのテキスト。
 */
const model = defineModel<string>({ required: true })

const props = withDefaults(
  defineProps<{
    placeholder?: string
    ariaLabel?: string
    minRows?: number
  }>(),
  { placeholder: '', ariaLabel: '本文', minRows: 6 },
)

const editing = ref(false)
const textarea = ref<HTMLTextAreaElement | null>(null)

const html = computed(() => renderScrapbox(model.value))
const isEmpty = computed(() => !model.value.trim())
const placeholderHtml = computed(
  () => `<p class="sb-line">${escapeHtml(props.placeholder || '本文を書く')}</p>`,
)

async function startEditing(atEnd = false) {
  editing.value = true
  await nextTick()
  const el = textarea.value
  if (!el) return
  el.focus()
  if (atEnd) el.setSelectionRange(el.value.length, el.value.length)
}

function stopEditing() {
  editing.value = false
}

/** 表示部分のリンクを押したときは、編集に切り替えない。 */
function onPreviewClick(event: MouseEvent) {
  const target = event.target as HTMLElement | null
  if (target?.closest('a')) return
  void startEditing()
}

defineExpose({ focus: () => startEditing(true) })
</script>

<template>
  <div class="editor">
    <textarea
      v-if="editing"
      ref="textarea"
      v-model="model"
      class="editor__input"
      :rows="props.minRows"
      :placeholder="props.placeholder"
      :aria-label="props.ariaLabel"
      @blur="stopEditing"
      @keydown.esc.prevent="stopEditing"
    />

    <!--
      空でも同じ要素で描画する。中身によって要素の種類を変えると、
      本文が非同期に届く分割表示でハイドレーションがずれる。

      renderScrapbox は入力を全てエスケープしてから組み立てるため、
      ここで v-html を使ってよい（docs/11-scrapbox-notation.md 11.9）。
    -->
    <div
      v-else
      class="editor__preview"
      :class="{ 'editor__preview--empty': isEmpty }"
      :aria-label="props.ariaLabel"
      role="button"
      tabindex="0"
      @click="onPreviewClick"
      @keydown.enter.prevent="startEditing(true)"
      v-html="isEmpty ? placeholderHtml : html"
    />
  </div>
</template>

<style scoped>
.editor {
  display: grid;
}

.editor__input {
  font: inherit;
  width: 100%;
  resize: vertical;
  background: var(--surface);
  color: var(--text);
  border: 1px solid var(--accent);
  border-radius: var(--radius);
  padding: 0.75rem;
  outline: none;
  line-height: 1.7;
  /* 記法をそのまま扱うので、等幅寄りのほうが桁が読みやすい */
  font-variant-ligatures: none;
  tab-size: 2;
}

.editor__preview {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 0.75rem;
  min-height: 9rem;
  line-height: 1.7;
  text-align: left;
  cursor: text;
  color: inherit;
  font: inherit;
  overflow-wrap: anywhere;
}

.editor__preview--empty {
  color: var(--text-muted);
}

.editor__preview:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}

/* --- Scrapbox 記法の見た目 --- */

.editor__preview :deep(.sb-line) {
  margin: 0;
  /* 空行を潰さずに保つ */
  min-height: 1.7em;
}

.editor__preview :deep(.sb-list) {
  list-style: none;
  margin: 0;
  padding-left: 1.25rem;
}

.editor__preview :deep(.sb-list > li) {
  position: relative;
}

.editor__preview :deep(.sb-list > li)::before {
  content: '';
  position: absolute;
  left: -0.875rem;
  top: 0.75em;
  width: 0.3125rem;
  height: 0.3125rem;
  border-radius: 50%;
  background: var(--text-muted);
}

/*
 * Scrapbox に見出し記法はなく、`*` の数で文字が大きく・太くなる。
 * `[/ 斜体]` や `[- 打ち消し]` は太字にしない。
 */
.editor__preview :deep([class*='sb-deco--level']) {
  font-weight: 700;
}

.editor__preview :deep(.sb-deco--level1) {
  font-size: 1.05em;
}
.editor__preview :deep(.sb-deco--level2) {
  font-size: 1.2em;
}
.editor__preview :deep(.sb-deco--level3) {
  font-size: 1.4em;
}
.editor__preview :deep(.sb-deco--level4) {
  font-size: 1.6em;
}
.editor__preview :deep(.sb-deco--level5) {
  font-size: 1.8em;
}
.editor__preview :deep(.sb-deco--level6) {
  font-size: 2em;
}

.editor__preview :deep(.sb-deco--italic) {
  font-style: italic;
}
.editor__preview :deep(.sb-deco--strike) {
  text-decoration: line-through;
}
.editor__preview :deep(.sb-deco--underline) {
  text-decoration: underline;
}

.editor__preview :deep(.sb-link) {
  color: var(--accent);
}

.editor__preview :deep(.sb-page-link) {
  color: var(--accent);
  border-bottom: 1px dotted currentcolor;
}

.editor__preview :deep(.sb-hashtag) {
  color: var(--accent);
}

.editor__preview :deep(.sb-quote) {
  margin: 0;
  padding-left: 0.75rem;
  border-left: 3px solid var(--border);
  color: var(--text-muted);
  display: grid;
}

.editor__preview :deep(.sb-code-inline) {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 0.9em;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 4px;
  padding: 0.0625rem 0.25rem;
}

.editor__preview :deep(.sb-code) {
  margin: 0.375rem 0;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 8px;
  overflow: hidden;
}

.editor__preview :deep(.sb-code__name) {
  padding: 0.25rem 0.625rem;
  border-bottom: 1px solid var(--border);
  color: var(--text-muted);
  font-size: 0.75rem;
}

.editor__preview :deep(.sb-code pre) {
  margin: 0;
  padding: 0.625rem;
  overflow-x: auto;
}

.editor__preview :deep(.sb-code code) {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 0.875rem;
}

.editor__preview :deep(.sb-image) {
  max-width: 100%;
  border-radius: 8px;
}

.editor__preview :deep(.sb-image--large) {
  width: 100%;
}
</style>
