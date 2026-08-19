<script setup lang="ts">
import { PRIORITIES, PRIORITY_LABELS, type Priority } from '~~/shared/types/item'
import type { Recurrence } from '~~/shared/types/recurrence'
import { describeRecurrence } from '~~/shared/utils/recurrence'
import {
  composeSmartAddInput,
  mergeSmartAddOverrides,
  parseSmartAdd,
  type SmartAddDue,
  type SmartAddOverrides,
} from '~~/shared/utils/smart-add'
import { splitInput } from '~~/shared/utils/text'

const props = withDefaults(
  defineProps<{
    placeholder?: string
    /**
     * 複数行を受け付けるか。false なら SmartAdd 専用の1行入力。
     *
     * 狭い画面ではこの指定に関わらず複数行にする。キーボードの改行を
     * 送信に使ってしまうと、本文（2行目以降）を書く手段が無くなるため。
     */
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

/**
 * 複数行を受け付けるか。
 *
 * 狭い画面では指定に関わらず複数行にする。キーボードの改行を送信に
 * 使ってしまうと、本文（2行目以降）を書く手段が無くなるため。
 * 送信はボタン（と ⌘ + Enter）で行う。
 */
const multiline = computed(() => props.multiline || narrow.value)

function close() {
  opened.value = false
  sheet.value = null
  priorityOpen.value = false
}

const canSubmit = computed(() => text.value.trim().length > 0)

// --- ボタンで選ぶ期限・重要度・タグ・繰り返し ------------------------------
//
// スマートフォンでは記号（`^` `!` `#` `*`）を打つのが手間なので、RTM と
// 同じように入力欄とは別のボタンからも選べるようにする（8.4）。
// 選んだ内容は SmartAdd の記法としてテキストへ書き戻す（composeSmartAddInput）。
// 追加の経路をテキスト1本に保てるので、共有の受付・オフラインの送信列・
// サーバーのどれにも手を入れずに済む。

/** 開いている選択画面。重要度は行を広げるだけなので別に持つ。 */
const sheet = ref<'due' | 'tags' | 'recurrence' | null>(null)
const priorityOpen = ref(false)

/** `undefined` はボタンを使っていないこと。その項目はテキストの記法に従う。 */
const due = ref<SmartAddDue | null>()
const priority = ref<Priority | null>()
const tags = ref<string[]>()
const recurrence = ref<Recurrence | null>()

const overrides = computed<SmartAddOverrides>(() => ({
  due: due.value,
  priority: priority.value,
  tags: tags.value,
  recurrence: recurrence.value,
}))

/** 送信するテキスト。ボタンで選んだ内容を書き戻したもの。 */
const composed = computed(() =>
  composeSmartAddInput(text.value, overrides.value),
)

/**
 * 入力中のプレビュー（docs/08-todo-management.md 8.5）。
 *
 * サーバーと同じパーサを使うため、表示と保存結果が食い違わない。
 * 書き戻したあとのテキストを読むので、ボタンで選んだ内容もここに出る。
 */
const parsed = computed(() => {
  const split = splitInput(composed.value)
  if (!split) return null
  return { ...parseSmartAdd(split.titleLine), body: split.body }
})

/**
 * いまの指定内容。テキストの記法とボタンで選んだ内容を重ねたもの。
 *
 * まだ何も書いていなくても、選んだ内容はボタンとプレビューに出したいので、
 * 書き戻したテキストではなくこちらを見る。
 */
const values = computed(() =>
  mergeSmartAddOverrides(parsed.value, overrides.value),
)

const recurrenceLabel = computed(() =>
  values.value.recurrence ? describeRecurrence(values.value.recurrence) : null,
)

function selectPriority(value: Priority | null) {
  priority.value = value
  priorityOpen.value = false
}

function applyDue(value: SmartAddDue | null) {
  due.value = value
  sheet.value = null
}

function applyTags(changes: { add: string[]; remove: string[] }) {
  const next = new Set(values.value.tags)
  for (const name of changes.add) next.add(name)
  for (const name of changes.remove) next.delete(name)
  tags.value = [...next].sort()
  sheet.value = null
}

function applyRecurrence(value: Recurrence | null) {
  recurrence.value = value
  sheet.value = null
}

/** 選んだ内容を捨てる。追加したものの設定を次の入力に持ち越さない。 */
function clearOverrides() {
  due.value = undefined
  priority.value = undefined
  tags.value = undefined
  recurrence.value = undefined
  priorityOpen.value = false
  sheet.value = null
}

const dueLabel = computed(() => {
  const selected = values.value.due
  if (!selected) return null
  return formatDue({
    dueAt: selected.date.toISOString(),
    dueHasTime: selected.hasTime,
  } as never).label
})

/**
 * 記法を使ったか、ボタンで選んだときだけプレビューを出す。
 * 普通の文章では邪魔になるため。
 */
const showPreview = computed(
  () =>
    values.value.due !== null ||
    values.value.dueCleared ||
    values.value.priority !== null ||
    values.value.tags.length > 0 ||
    values.value.recurrence !== null ||
    (parsed.value?.warnings.length ?? 0) > 0,
)

function autoGrow() {
  const el = textarea.value
  if (!el) return
  el.style.height = 'auto'
  el.style.height = `${el.scrollHeight}px`
}

function submit() {
  if (!canSubmit.value) return
  emit('submit', composed.value)
  // 送信完了を待たずに空にする。続けて書けることを優先する。
  text.value = ''
  clearOverrides()

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
    // Shift+Enter は常に改行。1行入力（PC の新規タスク追加）でも
    // 本文を書けるようにする。
    if (event.shiftKey) return
    // 1行入力なら Enter で送信。複数行なら ⌘/Ctrl + Enter。
    if (!multiline.value || event.metaKey || event.ctrlKey) {
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
        <span class="composer__preview-title">{{ parsed?.title || '（タイトルなし）' }}</span>
        <span v-if="values.priority" class="composer__chip">
          重要度{{ PRIORITY_LABELS[values.priority] }}
        </span>
        <span v-if="dueLabel" class="composer__chip">期限 {{ dueLabel }}</span>
        <span v-else-if="values.dueCleared" class="composer__chip">期限なし</span>
        <span v-for="tag in values.tags" :key="tag" class="composer__chip">
          #{{ tag }}
        </span>
        <span v-if="recurrenceLabel" class="composer__chip">
          {{ recurrenceLabel }}
        </span>
        <span
          v-for="warning in parsed?.warnings ?? []"
          :key="warning"
          class="composer__chip composer__chip--warning"
        >
          {{ warning }}
        </span>
      </div>

      <!--
        期限・重要度・タグ・繰り返しをボタンから選ぶ（8.4）。
        記号を打ちにくい狭い画面だけに出す。出す・出さないを CSS で決めるのは
        入力欄と同じ理由（幅の判定は最初の描画に間に合わない）。
      -->
      <div class="composer__tools">
        <button
          type="button"
          class="composer__tool"
          :class="{ 'composer__tool--on': values.due }"
          @click="sheet = 'due'"
        >
          期限
        </button>
        <button
          type="button"
          class="composer__tool"
          :class="{ 'composer__tool--on': values.priority }"
          :aria-expanded="priorityOpen"
          @click="priorityOpen = !priorityOpen"
        >
          重要度
        </button>
        <button
          type="button"
          class="composer__tool"
          :class="{ 'composer__tool--on': values.tags.length > 0 }"
          @click="sheet = 'tags'"
        >
          タグ
        </button>
        <button
          type="button"
          class="composer__tool"
          :class="{ 'composer__tool--on': values.recurrence }"
          @click="sheet = 'recurrence'"
        >
          繰り返し
        </button>
      </div>

      <!-- 重要度は選択肢が4つしかないので、別画面にせずその場で開く -->
      <div v-if="priorityOpen" class="composer__tools composer__tools--priority">
        <button
          v-for="value in PRIORITIES"
          :key="value"
          type="button"
          class="composer__tool"
          :class="{ 'composer__tool--on': values.priority === value }"
          @click="selectPriority(value)"
        >
          {{ PRIORITY_LABELS[value] }}
        </button>
        <button
          type="button"
          class="composer__tool"
          :class="{ 'composer__tool--on': !values.priority }"
          @click="selectPriority(null)"
        >
          なし
        </button>
      </div>

      <div class="composer__actions">
        <span class="composer__hint">
          {{ multiline ? '⌘ + Enter で追加' : 'Enter で追加（Shift + Enter で改行）' }} ・
          ^期限 !重要度 #タグ
          <span v-if="!values.due && !values.dueCleared" class="composer__default">
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

    <!-- 一覧での設定と同じ画面を使う。覚えることを増やさないため -->
    <DueDialog
      v-if="sheet === 'due'"
      :count="1"
      @submit="applyDue"
      @close="sheet = null"
    />

    <TagDialog
      v-if="sheet === 'tags'"
      :tags="values.tags"
      :count="1"
      @apply="applyTags"
      @close="sheet = null"
    />

    <RecurrenceDialog
      v-if="sheet === 'recurrence'"
      :count="1"
      :current="values.recurrence"
      @submit="applyRecurrence"
      @close="sheet = null"
    />
  </template>
</template>

<style scoped>
.composer {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  box-shadow: var(--shadow);
  padding: 0.2rem;
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
  padding-bottom: calc(0.2rem + env(safe-area-inset-bottom));
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

/*
 * 期限などを選ぶボタン。狭い画面だけに出す。
 *
 * 広い画面は記法（^ ! # *）を打つほうが速く、ヒントも出しているので置かない。
 * 入力欄と同じく CSS で切り替える（幅の判定は最初の描画に間に合わない）。
 */
.composer__tools {
  display: none;
  flex-wrap: wrap;
  gap: 0.375rem;
}

@media (max-width: 40rem) {
  .composer__tools {
    display: flex;
  }
}

/* 重要度の選択肢。どのボタンから開いたかが分かるよう、少し右へ寄せる */
.composer__tools--priority {
  padding-left: 0.5rem;
}

.composer__tool {
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 999px;
  color: var(--text-muted);
  /* タップ目標として十分な大きさを確保する */
  min-height: 2.25rem;
  padding: 0 0.75rem;
  font-size: 0.875rem;
}

/* 設定済み。プレビューの内容と合わせて見る */
.composer__tool--on {
  border-color: var(--accent);
  color: var(--accent);
  font-weight: 600;
}

.composer__actions {
  display: flex;
  align-items: center;
  /* ヒントを消しても、ボタンは右端に残す */
  justify-content: flex-end;
  gap: 0.75rem;
}

/*
 * 書いていない間は場所を取らせない。:focus-within なので、送信ボタンへ
 * クリックが移る間もフォーム内である限り消えない（ボタンが消えて
 * 押せなくなることはない）。
 */
.composer:not(:focus-within) .composer__actions {
  display: none;
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
