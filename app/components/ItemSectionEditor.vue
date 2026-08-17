<script setup lang="ts">
import { SAVE_STATE_LABELS } from '~/composables/useAutosave'
import type { SectionDto } from '~~/shared/types/item'

const props = defineProps<{ section: SectionDto }>()

const emit = defineEmits<{
  save: [body: string]
  remove: []
}>()

const body = ref(props.section.body)

const { state, errorMessage, markSynced } = useAutosave({
  source: body,
  save: async (value) => emit('save', value),
})

// 親が再取得したときに追随する。編集中の内容は上書きしない。
watch(
  () => props.section.body,
  (value) => {
    if (state.value !== 'idle' && state.value !== 'saved') return
    if (value === body.value) return
    body.value = value
    markSynced()
  },
)

const dateLabel = computed(() => {
  const [year, month, day] = props.section.date.split('-')
  return `${year}/${month}/${day}`
})
</script>

<template>
  <article class="section">
    <header class="section__head">
      <time class="section__date" :datetime="section.date">{{ dateLabel }}</time>
      <span class="section__save" :class="`section__save--${state}`">
        {{ SAVE_STATE_LABELS[state] }}
      </span>
      <button
        type="button"
        class="section__remove"
        :aria-label="`${dateLabel} の作業記録を削除`"
        @click="emit('remove')"
      >
        削除
      </button>
    </header>
    <textarea
      v-model="body"
      class="section__input"
      rows="4"
      :aria-label="`${dateLabel} の作業記録`"
    />
    <p v-if="errorMessage" class="section__error" role="alert">
      {{ errorMessage }}
    </p>
  </article>
</template>

<style scoped>
.section {
  display: grid;
  gap: 0.375rem;
}

.section__head {
  display: flex;
  align-items: baseline;
  gap: 0.625rem;
}

.section__date {
  font-size: 0.8125rem;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}

.section__save {
  flex: 1;
  font-size: 0.75rem;
  color: var(--text-muted);
}

.section__save--error {
  color: var(--danger);
}

.section__remove {
  background: transparent;
  border: 0;
  color: var(--danger);
  font-size: 0.8125rem;
  min-height: 2.25rem;
  padding: 0 0.375rem;
}

.section__input {
  width: 100%;
  resize: vertical;
  background: var(--surface);
  color: var(--text);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 0.625rem 0.75rem;
  outline: none;
  line-height: 1.7;
}

.section__input:focus {
  border-color: var(--accent);
}

.section__error {
  margin: 0;
  color: var(--danger);
  font-size: 0.8125rem;
}
</style>
