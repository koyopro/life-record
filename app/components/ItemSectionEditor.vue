<script setup lang="ts">
import type { SectionDto } from '~~/shared/types/item'
import { formatAppDate, isAppDate } from '~~/shared/utils/date'

const props = defineProps<{
  /** この記録が属する Item。ストアを引くのに要る。 */
  itemId: string
  section: SectionDto
  /** 同じ日付の中で、上下に動かせるか。 */
  canMoveUp?: boolean
  canMoveDown?: boolean
}>()

const emit = defineEmits<{
  changeDate: [date: string]
  move: [delta: -1 | 1]
  remove: []
}>()

const store = useItemDetailStore()

/*
 * 下書きを画面側に持たない。打鍵はそのままストアへ渡し、送信はストアが
 * 遅らせて裏で行う（docs/14-client-state.md）。持たないので、
 * 「編集中はサーバーの内容で上書きしない」という手当ても要らない。
 */
const body = computed({
  get: () => store.sectionBodyOf(props.itemId, props.section.id),
  set: (value: string) => store.editSectionBody(props.itemId, props.section.id, value),
})

const save = computed(() => store.sectionStatus(props.itemId, props.section.id))

const dateLabel = computed(() => formatAppDate(props.section.date))

/**
 * 日付を変える。
 *
 * 入力途中（`2026-0` など）や、消したところで発火するので、
 * 日付として成立していないうちは送らない。
 */
function onDateInput(event: Event) {
  const value = (event.target as HTMLInputElement).value
  if (!isAppDate(value) || value === props.section.date) return
  emit('changeDate', value)
}

const editor = ref<{ focus: () => void } | null>(null)

defineExpose({ focus: () => editor.value?.focus() })
</script>

<template>
  <article class="section">
    <header class="section__head">
      <!--
        日付は表示だけでなく直せるようにする。作業した日を後から書き足す
        ことがあるため（docs/03-functional-spec.md 3.2）。
      -->
      <input
        class="section__date"
        type="date"
        :value="section.date"
        :aria-label="`${dateLabel} の作業記録の日付`"
        @change="onDateInput"
      />
      <!--
        その日の日記へ。Section と Diary は日付だけで結び付く
        （docs/02-data-model.md 2.7）。
      -->
      <NuxtLink
        class="section__diary"
        :to="`/diary/${section.date}`"
        :aria-label="`${dateLabel} の日記を開く`"
      >
        日記
      </NuxtLink>
      <span class="section__save">
        <SaveDot :state="save.state" />
      </span>
      <button
        v-if="canMoveUp"
        type="button"
        class="section__button"
        :aria-label="`${dateLabel} の作業記録を上へ`"
        @click="emit('move', -1)"
      >
        ↑
      </button>
      <button
        v-if="canMoveDown"
        type="button"
        class="section__button"
        :aria-label="`${dateLabel} の作業記録を下へ`"
        @click="emit('move', 1)"
      >
        ↓
      </button>
      <button
        type="button"
        class="section__button section__button--danger"
        :aria-label="`${dateLabel} の作業記録を削除`"
        @click="emit('remove')"
      >
        削除
      </button>
    </header>
    <ScrapboxEditor
      ref="editor"
      v-model="body"
      :aria-label="`${dateLabel} の作業記録`"
      placeholder="この日にやったこと"
    />
    <p v-if="save.error" class="section__error" role="alert">
      {{ save.error }}
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
  align-items: center;
  gap: 0.375rem;
}

.section__date {
  font: inherit;
  font-size: 0.8125rem;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  background: transparent;
  border: 1px solid transparent;
  border-radius: 6px;
  color: var(--text);
  padding: 0.125rem 0.25rem;
}

.section__date:hover,
.section__date:focus {
  border-color: var(--border);
}

.section__diary {
  color: var(--text-muted);
  text-decoration: none;
  font-size: 0.75rem;
  border: 1px solid var(--border);
  border-radius: 999px;
  padding: 0.0625rem 0.5rem;
}

.section__save {
  flex: 1;
}

.section__button {
  background: transparent;
  border: 0;
  color: var(--text-muted);
  font-size: 0.8125rem;
  min-height: 2.25rem;
  padding: 0 0.375rem;
}

.section__button--danger {
  color: var(--danger);
}

.section__error {
  margin: 0;
  color: var(--danger);
  font-size: 0.8125rem;
}
</style>
