<script setup lang="ts">
import { PRIORITY_LABELS } from '~~/shared/types/item'
import { parseSmartAdd } from '~~/shared/utils/smart-add'
import { splitInput } from '~~/shared/utils/text'

const props = withDefaults(
  defineProps<{
    placeholder?: string
    /** 複数行を受け付けるか。false なら SmartAdd 専用の1行入力。 */
    multiline?: boolean
  }>(),
  {
    placeholder: '思いついたことを書く\n1行目がタイトルになります',
    multiline: true,
  },
)

const emit = defineEmits<{ submit: [text: string] }>()

const text = ref('')
const textarea = ref<HTMLTextAreaElement | null>(null)

const canSubmit = computed(() => text.value.trim().length > 0)

/**
 * 入力中のプレビュー（docs/08-todo-management.md 8.5）。
 *
 * サーバーと同じパーサを使うため、表示と保存結果が食い違わない。
 */
const parsed = computed(() => {
  const split = splitInput(text.value)
  if (!split) return null
  return { ...parseSmartAdd(split.titleLine), body: split.body }
})

const dueLabel = computed(() => {
  const dueAt = parsed.value?.dueAt
  if (!dueAt) return null
  return formatDue({
    dueAt: dueAt.toISOString(),
    dueHasTime: parsed.value?.dueHasTime ?? false,
  } as never).label
})

/** 記法が使われたときだけプレビューを出す。普通の文章では邪魔になるため。 */
const showPreview = computed(
  () =>
    Boolean(parsed.value) &&
    (parsed.value!.dueAt !== null ||
      parsed.value!.priority !== null ||
      parsed.value!.warnings.length > 0),
)

function autoGrow() {
  const el = textarea.value
  if (!el) return
  el.style.height = 'auto'
  el.style.height = `${el.scrollHeight}px`
}

function submit() {
  if (!canSubmit.value) return
  emit('submit', text.value)
  // 送信完了を待たずに空にする。続けて書けることを優先する。
  text.value = ''
  nextTick(() => {
    autoGrow()
    textarea.value?.focus()
  })
}

/**
 * 日本語入力の変換中か。
 *
 * 変換を確定する Enter を送信として扱うと、書きかけのタイトルで
 * 追加されてしまう。ブラウザによって知らせ方が違うので両方を見る。
 *
 * - Chrome / Firefox … 確定の keydown は `isComposing` が true
 * - Safari            … compositionend が先に来るため `isComposing` は
 *                       false になる。代わりに keyCode が 229 になる
 */
function isComposing(event: KeyboardEvent) {
  return event.isComposing || event.keyCode === 229
}

function onKeydown(event: KeyboardEvent) {
  if (event.key === 'Enter') {
    if (isComposing(event)) return
    // 1行入力なら Enter で送信。複数行なら ⌘/Ctrl + Enter。
    if (!props.multiline || event.metaKey || event.ctrlKey) {
      event.preventDefault()
      submit()
    }
  }
}

function focus() {
  textarea.value?.focus()
}

defineExpose({ focus })

/*
 * 開いた直後の自動フォーカスは持たない。フォーカスされていると一覧の
 * キーボード操作が入力欄に吸われ、スマートフォンでは勝手にキーボードが出る。
 * 書き始めるときは `t` でここへ移る（docs/08-todo-management.md 8.4）。
 */
useComposerRegistration(focus)
</script>

<template>
  <form class="composer" @submit.prevent="submit">
    <textarea
      ref="textarea"
      v-model="text"
      class="composer__input"
      :rows="multiline ? 2 : 1"
      :placeholder="placeholder"
      autocapitalize="off"
      @input="autoGrow"
      @keydown="onKeydown"
    />

    <div v-if="showPreview" class="composer__preview">
      <span class="composer__preview-title">{{ parsed!.title || '（タイトルなし）' }}</span>
      <span v-if="parsed!.priority" class="composer__chip">
        重要度{{ PRIORITY_LABELS[parsed!.priority] }}
      </span>
      <span v-if="dueLabel" class="composer__chip">期限 {{ dueLabel }}</span>
      <span
        v-for="warning in parsed!.warnings"
        :key="warning"
        class="composer__chip composer__chip--warning"
      >
        {{ warning }}
      </span>
    </div>

    <div class="composer__actions">
      <span class="composer__hint">
        {{ multiline ? '⌘ + Enter で追加' : 'Enter で追加' }} ・ ^期限 !重要度 #タグ
        <span v-if="!parsed?.dueAt" class="composer__default">
          ・ 期限は今日
        </span>
      </span>
      <button type="submit" class="composer__submit" :disabled="!canSubmit">
        追加
      </button>
    </div>
  </form>
</template>

<style scoped>
.composer {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  box-shadow: var(--shadow);
  padding: 0.75rem;
  display: grid;
  gap: 0.5rem;
}

.composer__input {
  width: 100%;
  max-height: 60vh;
  resize: none;
  border: 0;
  outline: none;
  background: transparent;
  color: var(--text);
  padding: 0.25rem;
  overflow-y: auto;
}

.composer__input::placeholder {
  color: var(--text-muted);
}

.composer__preview {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.375rem;
  padding: 0.375rem 0.25rem 0;
  border-top: 1px dashed var(--border);
  font-size: 0.8125rem;
}

.composer__preview-title {
  font-weight: 600;
  overflow-wrap: anywhere;
}

.composer__chip {
  background: color-mix(in srgb, var(--accent) 14%, transparent);
  color: var(--accent);
  border-radius: 999px;
  padding: 0.0625rem 0.5rem;
}

.composer__chip--warning {
  background: color-mix(in srgb, var(--danger) 14%, transparent);
  color: var(--danger);
}

.composer__actions {
  display: flex;
  align-items: center;
  /* ヒントを消しても、ボタンは右端に残す */
  justify-content: flex-end;
  gap: 0.75rem;
}

.composer__hint {
  color: var(--text-muted);
  font-size: 0.8125rem;
  /* 余った幅はヒント側が持つ。足りなければ縮むのもこちら */
  flex: 1 1 auto;
  min-width: 0;
}

/* 期限を書かなかったときに何が入るかを、送信前に見せる */
.composer__default {
  color: var(--accent);
}

/*
 * タッチ主体の端末ではショートカットが使えないので隠す。
 * visibility では場所を取ったままになり、狭い画面でボタンを潰す。
 */
@media (hover: none) {
  .composer__hint {
    display: none;
  }
}

.composer__submit {
  background: var(--accent);
  color: var(--accent-text);
  border: 0;
  border-radius: 8px;
  /* タップ目標として十分な大きさを確保する */
  min-height: 2.75rem;
  padding: 0 1.5rem;
  font-weight: 600;
  /* 幅が足りなくても縮めない。「追加」が縦に折り返してしまう */
  flex: 0 0 auto;
  white-space: nowrap;
}

.composer__submit:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
</style>
