<script setup lang="ts">
import type { DiarySummaryDto } from '~~/shared/types/diary'
import { formatAppDate, isAppDate, toAppDate } from '~~/shared/utils/date'

/** 日記の一覧（docs/03-functional-spec.md 3.3）。日付の新しい順。 */
const { data: diaries, error } = await useFetch<DiarySummaryDto[]>(
  '/api/diaries',
  { default: () => [] },
)

useHead({ title: '日記' })

const today = toAppDate()

const hasToday = computed(() =>
  (diaries.value ?? []).some((entry) => entry.date === today),
)

function onDateInput(event: Event) {
  const value = (event.target as HTMLInputElement).value
  if (!isAppDate(value)) return
  void navigateTo(`/diary/${value}`)
}
</script>

<template>
  <div class="page">
    <header class="head">
      <h1 class="head__title">日記</h1>
      <input
        class="head__date"
        type="date"
        :value="today"
        aria-label="日付を選んで開く"
        @change="onDateInput"
      />
    </header>

    <NuxtLink class="today" :to="`/diary/${today}`">
      {{ hasToday ? '今日の日記を開く' : '今日の日記を書く' }}
    </NuxtLink>

    <p v-if="error" class="page__error" role="alert">
      日記を読み込めませんでした
    </p>

    <p v-else-if="!diaries.length" class="page__placeholder">
      まだ日記がありません。
    </p>

    <ul v-else class="list">
      <li v-for="entry in diaries" :key="entry.date">
        <NuxtLink class="entry" :to="`/diary/${entry.date}`">
          <div class="entry__head">
            <time class="entry__date" :datetime="entry.date">
              {{ formatAppDate(entry.date) }}
            </time>
            <span v-if="entry.itemCount" class="entry__count">
              やったこと {{ entry.itemCount }}件
            </span>
          </div>
          <p class="entry__excerpt">{{ entry.excerpt }}</p>
        </NuxtLink>
      </li>
    </ul>
  </div>
</template>

<style scoped>
.page {
  display: grid;
  gap: 1rem;
}

.head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.625rem;
}

.head__title {
  margin: 0;
  font-size: 1.25rem;
  font-weight: 700;
}

.head__date {
  font: inherit;
  /* iOS でフォーカス時に自動ズームされないよう 16px を保つ */
  font-size: 1rem;
  font-variant-numeric: tabular-nums;
  background: var(--bg);
  color: var(--text);
  border: 1px solid var(--border);
  border-radius: 8px;
  min-height: 2.25rem;
  padding: 0 0.5rem;
}

.today {
  justify-self: start;
  background: var(--accent);
  border-radius: 999px;
  color: var(--accent-text);
  text-decoration: none;
  font-size: 0.875rem;
  font-weight: 600;
  min-height: 2.5rem;
  display: inline-flex;
  align-items: center;
  padding: 0 1rem;
}

.page__error {
  margin: 0;
  color: var(--danger);
  font-size: 0.875rem;
}

.page__placeholder {
  margin: 0;
  color: var(--text-muted);
  text-align: center;
  padding: 2rem 0;
}

.list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: 0.5rem;
}

.entry {
  display: grid;
  gap: 0.25rem;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 0.75rem;
  color: inherit;
  text-decoration: none;
}

.entry__head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 0.75rem;
}

.entry__date {
  font-size: 0.875rem;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}

.entry__count {
  color: var(--text-muted);
  font-size: 0.75rem;
  flex-shrink: 0;
}

.entry__excerpt {
  margin: 0;
  color: var(--text-muted);
  font-size: 0.875rem;
  line-height: 1.6;
  /* 一覧では冒頭だけ見えれば十分 */
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 3;
  overflow: hidden;
  white-space: pre-wrap;
}
</style>
