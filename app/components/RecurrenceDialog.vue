<script setup lang="ts">
import type { Recurrence } from '~~/shared/types/recurrence'
import {
  RECURRENCE_PRESETS,
  describeRecurrence,
  parseRecurrence,
} from '~~/shared/utils/recurrence'

const props = defineProps<{
  count: number
  /** 現在の設定。編集時に初期値として入れる。 */
  current?: Recurrence | null
}>()

const emit = defineEmits<{
  submit: [recurrence: Recurrence | null]
  close: []
}>()

const text = ref(props.current ? describeRecurrence(props.current) : '')
const input = ref<HTMLInputElement | null>(null)

const parsed = computed(() =>
  text.value.trim() ? parseRecurrence(text.value) : null,
)

const preview = computed(() => {
  if (!text.value.trim()) return '「毎週」「毎週月曜」「完了の3日後」のように書けます'
  if (!parsed.value) return '繰り返しとして解釈できませんでした'
  return describeRecurrence(parsed.value)
})

/**
 * every と after の違いは、この機能でいちばん取り違えやすい部分なので
 * 選んだ結果が何を意味するかを明示する（docs/10-recurrence.md 10.1）。
 */
const basisNote = computed(() => {
  if (!parsed.value) return null
  return parsed.value.basis === 'due'
    ? '完了が遅れても、次回期限は元の期限から進みます'
    : '完了した日を起点に、次回期限が決まります'
})

function pick(preset: string) {
  text.value = preset
  input.value?.focus()
}

function submit() {
  if (!parsed.value) return
  emit('submit', parsed.value)
}

onMounted(() => input.value?.focus())
</script>

<template>
  <div class="overlay" @click.self="emit('close')">
    <form
      class="sheet"
      role="dialog"
      aria-modal="true"
      aria-label="繰り返しを設定"
      @submit.prevent="submit"
    >
      <h2 class="sheet__title">
        繰り返し<span v-if="count > 1"> ({{ count }}件)</span>
      </h2>

      <input
        ref="input"
        v-model="text"
        class="sheet__input"
        type="text"
        placeholder="毎週 / 毎週月曜 / 完了の3日後"
        autocomplete="off"
        autocapitalize="off"
        @keydown.esc.prevent="emit('close')"
      />

      <p
        class="sheet__preview"
        :class="{ 'sheet__preview--invalid': text.trim() && !parsed }"
      >
        {{ preview }}
      </p>
      <p v-if="basisNote" class="sheet__note">{{ basisNote }}</p>

      <div class="sheet__presets">
        <button
          v-for="preset in RECURRENCE_PRESETS"
          :key="preset.input"
          type="button"
          class="chip"
          @click="pick(preset.input)"
        >
          {{ preset.label }}
        </button>
      </div>

      <div class="sheet__actions">
        <button type="button" class="sheet__clear" @click="emit('submit', null)">
          繰り返しをやめる
        </button>
        <div class="sheet__right">
          <button type="button" class="sheet__cancel" @click="emit('close')">
            キャンセル
          </button>
          <button type="submit" class="sheet__submit" :disabled="!parsed">
            設定
          </button>
        </div>
      </div>
    </form>
  </div>
</template>

<style scoped>
.overlay {
  position: fixed;
  inset: 0;
  background: rgb(0 0 0 / 45%);
  display: grid;
  place-items: center;
  padding: 1rem;
  z-index: 20;
}

.sheet {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  box-shadow: var(--shadow);
  width: min(28rem, 100%);
  max-height: 80vh;
  overflow-y: auto;
  padding: 1rem;
  display: grid;
  gap: 0.5rem;
}

.sheet__title {
  margin: 0;
  font-size: 1rem;
}

.sheet__input {
  font: inherit;
  /* iOS でフォーカス時に自動ズームされないよう 16px を保つ */
  font-size: 1rem;
  width: 100%;
  min-height: 2.75rem;
  padding: 0 0.75rem;
  background: var(--bg);
  color: var(--text);
  border: 1px solid var(--border);
  border-radius: 8px;
}

.sheet__preview {
  margin: 0;
  font-size: 0.8125rem;
  color: var(--text-muted);
  min-height: 1.25rem;
}

.sheet__preview--invalid {
  color: var(--danger);
}

.sheet__note {
  margin: 0;
  font-size: 0.75rem;
  color: var(--text-muted);
}

.sheet__presets {
  display: flex;
  flex-wrap: wrap;
  gap: 0.375rem;
  padding-top: 0.25rem;
}

.chip {
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 999px;
  color: var(--text);
  min-height: 2.25rem;
  padding: 0 0.75rem;
  font-size: 0.875rem;
}

.sheet__actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
  padding-top: 0.25rem;
}

.sheet__right {
  display: flex;
  gap: 0.5rem;
}

.sheet__clear,
.sheet__cancel {
  background: transparent;
  border: 1px solid var(--border);
  border-radius: 8px;
  color: var(--text-muted);
  min-height: 2.75rem;
  padding: 0 0.75rem;
}

.sheet__submit {
  background: var(--accent);
  color: var(--accent-text);
  border: 0;
  border-radius: 8px;
  min-height: 2.75rem;
  padding: 0 1.25rem;
  font-weight: 600;
}

.sheet__submit:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
</style>
