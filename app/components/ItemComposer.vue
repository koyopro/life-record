<script setup lang="ts">
import { PRIORITY_LABELS } from '~~/shared/types/item'
import { parseSmartAdd } from '~~/shared/utils/smart-add'
import { splitInput } from '~~/shared/utils/text'

const props = withDefaults(
  defineProps<{
    placeholder?: string
    /** 複数行を受け付けるか。false なら SmartAdd 専用の1行入力。 */
    multiline?: boolean
    /** 最初から入れておくテキスト。共有の受付（/share）で使う。 */
    initialText?: string
    /** 送信ボタンの文字。 */
    submitLabel?: string
    /**
     * 狭い画面でも入力欄をそのまま置くか。
     *
     * 既定では狭い画面では隠し、右下の「＋」から開く。書くことが目的の画面
     * （共有の受付）では、開く操作を挟まずそのまま出す。
     */
    inline?: boolean
  }>(),
  {
    placeholder: '思いついたことを書く\n1行目がタイトルになります',
    multiline: true,
    initialText: '',
    submitLabel: '追加',
    inline: false,
  },
)

const emit = defineEmits<{ submit: [text: string] }>()

const text = ref(props.initialText)
const textarea = ref<HTMLTextAreaElement | null>(null)

/**
 * 狭い画面では、入力欄を置く代わりに下から重ねて出す。
 *
 * 一覧をできるだけ広く見せたいので、書いていない間は場所を取らせない。
 * 開くのは右下の「＋」（app.vue）か `t`（docs/08-todo-management.md 8.4）。
 */
const narrow = useCompactLayout()
const compact = computed(() => narrow.value && !props.inline)
const opened = ref(false)

/** 重ねて出しているか。閉じている狭い画面では何も描かない。 */
const asSheet = computed(() => compact.value && opened.value)

function close() {
  opened.value = false
}

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

  // 重ねて出していたなら閉じる。追加したものが一覧に出るのを見せたい
  if (compact.value) {
    close()
    return
  }

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

/**
 * 書き始める。狭い画面では、まず入力欄を出してからフォーカスする。
 *
 * 右下の「＋」（app.vue）と `t` の行き先。
 */
function focus() {
  if (compact.value) opened.value = true
  // 描かれる前にフォーカスしても効かない
  nextTick(() => textarea.value?.focus())
}

// 最初から入っているテキストは、高さを合わせないと後ろが隠れる
onMounted(() => {
  if (props.initialText) autoGrow()
})

defineExpose({ focus })

/*
 * 開いた直後の自動フォーカスは持たない。フォーカスされていると一覧の
 * キーボード操作が入力欄に吸われ、スマートフォンでは勝手にキーボードが出る。
 * 書き始めるときは `t` でここへ移る（docs/08-todo-management.md 8.4）。
 */
useComposerRegistration(focus)
</script>

<template>
  <!--
    狭い画面で閉じている間は何も描かない。一覧に場所を譲る。
    書き始めるのは右下の「＋」（app.vue）か `t`。
  -->
  <template v-if="!compact || opened">
    <div v-if="asSheet" class="scrim" @click="close" />

    <form
      class="composer"
      :class="{ 'composer--sheet': asSheet, 'composer--inline': inline }"
      @submit.prevent="submit"
    >
      <textarea
        ref="textarea"
        v-model="text"
        class="composer__input"
        :rows="multiline ? 2 : 1"
        :placeholder="placeholder"
        autocapitalize="off"
        @input="autoGrow"
        @keydown="onKeydown"
        @keydown.esc="close"
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
        <button
          v-if="asSheet"
          type="button"
          class="composer__cancel"
          @click="close"
        >
          閉じる
        </button>
        <button type="submit" class="composer__submit" :disabled="!canSubmit">
          {{ submitLabel }}
        </button>
      </div>
    </form>
  </template>
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

/*
 * 狭い画面では、開いていない入力欄を出さない。
 *
 * 幅の判定（compact）が効くのはハイドレーションのあとなので、それに任せると
 * サーバーが描いた入力欄が一瞬見えて消え、その分だけ画面がずれる。
 * 最初の描画から隠れているように、CSS でも同じ境目を持つ。
 */
@media (max-width: 40rem) {
  .composer:not(.composer--sheet):not(.composer--inline) {
    display: none;
  }
}

/*
 * 狭い画面では、一覧の上に重ねて下端から出す（他のシートと同じ形）。
 * キーボードが出ても隠れないよう、viewport の
 * interactive-widget=resizes-content と組み合わせている（nuxt.config.ts）。
 */
.composer--sheet {
  position: fixed;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 20;
  border-radius: 16px 16px 0 0;
  padding-bottom: calc(0.75rem + env(safe-area-inset-bottom));
}

.scrim {
  position: fixed;
  inset: 0;
  background: rgb(0 0 0 / 45%);
  /* シートより下、フローティングボタンより上 */
  z-index: 19;
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

/* 重ねて出しているときだけ。書かずに閉じる導線 */
.composer__cancel {
  background: transparent;
  border: 0;
  color: var(--text-muted);
  min-height: 2.75rem;
  padding: 0 0.5rem;
  flex: 0 0 auto;
}
</style>
