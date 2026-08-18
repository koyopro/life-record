<script setup lang="ts">
import { normalizeTagName, parseTagNames } from '~~/shared/types/tag'

const props = defineProps<{
  /** いま付いているタグ（複数選択時は和集合）。 */
  tags: string[]
  /** 対象の件数。見出しに出す。 */
  count: number
  /** 開いた直後に外す側へ寄せるか（`Shift` + `t`）。 */
  focusRemoval?: boolean
}>()

const emit = defineEmits<{
  apply: [changes: { add: string[]; remove: string[] }]
  close: []
}>()

const { suggest } = useTags()

const input = ref('')
const inputEl = ref<HTMLInputElement | null>(null)

const currentTags = computed(() => [...new Set(props.tags)].sort())

const removing = ref<Set<string>>(new Set())

const adding = computed(() => parseTagNames(input.value))

const suggestions = computed(() =>
  suggest(input.value, [...currentTags.value, ...adding.value]),
)

const invalid = computed(() => {
  const raw = input.value.trim()
  if (!raw) return false
  // 途中まで入力した段階では警告を出さない
  return raw.endsWith(' ') && adding.value.length === 0
})

const canApply = computed(
  () => adding.value.length > 0 || removing.value.size > 0,
)

function toggleRemoval(name: string) {
  const next = new Set(removing.value)
  if (next.has(name)) next.delete(name)
  else next.add(name)
  removing.value = next
}

function pick(name: string) {
  const names = new Set(adding.value)
  names.add(name)
  input.value = `${[...names].join(' ')} `
  inputEl.value?.focus()
}

function apply() {
  if (!canApply.value) return
  emit('apply', { add: adding.value, remove: [...removing.value] })
}

onMounted(() => {
  if (!props.focusRemoval) inputEl.value?.focus()
})
</script>

<template>
  <div class="overlay" @click.self="emit('close')">
    <form
      class="sheet"
      role="dialog"
      aria-modal="true"
      aria-label="タグ"
      @submit.prevent="apply"
    >
      <h2 class="sheet__title">
        タグ<span v-if="count > 1"> ({{ count }}件)</span>
      </h2>

      <input
        ref="inputEl"
        v-model="input"
        class="sheet__input"
        type="text"
        placeholder="タグ名を空白区切りで入力"
        autocomplete="off"
        autocapitalize="off"
        @keydown.esc.prevent="emit('close')"
      />

      <p v-if="invalid" class="sheet__warning">
        空白・カンマ・# はタグ名に使えません
      </p>

      <div v-if="suggestions.length" class="sheet__suggestions">
        <button
          v-for="tag in suggestions"
          :key="tag.id"
          type="button"
          class="chip"
          @click="pick(tag.name)"
        >
          {{ tag.name }}
          <span class="chip__count">{{ tag.count }}</span>
        </button>
      </div>

      <template v-if="currentTags.length">
        <p class="sheet__label">
          付いているタグ<span class="sheet__hint">（押すと外す）</span>
        </p>
        <div class="sheet__current">
          <button
            v-for="name in currentTags"
            :key="name"
            type="button"
            class="chip"
            :class="{ 'chip--removing': removing.has(name) }"
            :aria-pressed="removing.has(name)"
            @click="toggleRemoval(name)"
          >
            {{ name }}
            <span aria-hidden="true">{{ removing.has(name) ? '↩' : '×' }}</span>
          </button>
        </div>
      </template>

      <div class="sheet__actions">
        <button type="button" class="sheet__cancel" @click="emit('close')">
          キャンセル
        </button>
        <button type="submit" class="sheet__submit" :disabled="!canApply">
          適用
        </button>
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

.sheet__warning {
  margin: 0;
  color: var(--danger);
  font-size: 0.8125rem;
}

.sheet__label {
  margin: 0.25rem 0 0;
  font-size: 0.8125rem;
  color: var(--text-muted);
}

.sheet__hint {
  font-size: 0.75rem;
}

.sheet__suggestions,
.sheet__current {
  display: flex;
  flex-wrap: wrap;
  gap: 0.375rem;
}

.chip {
  display: inline-flex;
  align-items: center;
  gap: 0.375rem;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 999px;
  color: var(--text);
  min-height: 2.25rem;
  padding: 0 0.75rem;
  font-size: 0.875rem;
}

.chip__count {
  color: var(--text-muted);
  font-size: 0.75rem;
  font-variant-numeric: tabular-nums;
}

/* 外す対象は打ち消し線で示す。適用前に取り消せるようにするため */
.chip--removing {
  border-color: var(--danger);
  color: var(--danger);
  text-decoration: line-through;
}

.sheet__actions {
  display: flex;
  justify-content: flex-end;
  gap: 0.5rem;
  padding-top: 0.25rem;
}

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
