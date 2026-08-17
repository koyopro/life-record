<script setup lang="ts">
import { parseDueExpression } from '~~/shared/utils/smart-add'

const props = defineProps<{ count: number }>()

const emit = defineEmits<{
  submit: [due: { date: Date; hasTime: boolean } | null]
  close: []
}>()

const text = ref('')
const input = ref<HTMLInputElement | null>(null)

/** SmartAdd の `^` と同じ解釈にする。覚えることを増やさないため。 */
const parsed = computed(() =>
  text.value.trim() ? parseDueExpression(text.value) : null,
)

const preview = computed(() => {
  if (!text.value.trim()) return '「明日」「金曜」「8/25 15:00」のように書けます'
  if (!parsed.value) return '日付として解釈できませんでした'
  return formatDue({
    dueAt: parsed.value.date.toISOString(),
    dueHasTime: parsed.value.hasTime,
  } as never).label
})

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
      aria-label="期限を設定"
      @submit.prevent="submit"
    >
      <h2 class="sheet__title">
        期限を設定<span v-if="props.count > 1"> ({{ props.count }}件)</span>
      </h2>

      <input
        ref="input"
        v-model="text"
        class="sheet__input"
        type="text"
        placeholder="明日 / 金曜 / 8/25 15:00"
        autocomplete="off"
        @keydown.esc.prevent="emit('close')"
      />

      <p class="sheet__preview" :class="{ 'sheet__preview--invalid': text.trim() && !parsed }">
        {{ preview }}
      </p>

      <div class="sheet__actions">
        <button type="button" class="sheet__clear" @click="emit('submit', null)">
          期限を外す
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
  width: min(26rem, 100%);
  padding: 1rem;
  display: grid;
  gap: 0.625rem;
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

.sheet__actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
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
