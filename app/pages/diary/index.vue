<script setup lang="ts">
import type { DiarySummaryDto } from '~~/shared/types/diary'
import {
  WEEKDAYS,
  firstDayOfMonth,
  formatAppDate,
  formatAppMonth,
  isAppDate,
  isAppMonth,
  lastDayOfMonth,
  monthGrid,
  monthOf,
  shiftAppMonth,
  toAppDate,
} from '~~/shared/utils/date'

/**
 * 日記の一覧（docs/03-functional-spec.md 3.3）。
 *
 * 日記は日付が主キーなので、一覧も**カレンダー**で見せる。
 * 縦に並べるだけだと、書いていない日が詰められて見えず、
 * どこが空いているのか分からない。
 */

/** 表示中の月。URL に持たせ、戻る・再読み込みで同じ月に戻れるようにする。 */
const route = useRoute()
const month = computed(() =>
  isAppMonth(route.query.month) ? route.query.month : monthOf(toAppDate()),
)

/*
 * top-level await にしない。待つと、月を送るたびに画面遷移そのものが
 * 取得の完了までブロックされ、切り替えるたびにラグが出るため。
 */
const { data: diaries, error, status } = useFetch<DiarySummaryDto[]>(
  '/api/diaries',
  {
    // 表示中の月ぶんだけを取る。月を移ると取り直す
    query: computed(() => ({
      from: firstDayOfMonth(month.value),
      to: lastDayOfMonth(month.value),
    })),
    default: () => [],
  },
)

useHead({ title: '日記' })

const today = toAppDate()
const thisMonth = monthOf(today)

const byDate = computed(
  () => new Map((diaries.value ?? []).map((entry) => [entry.date, entry])),
)
const days = computed(() => monthGrid(month.value))

/** その日が表示中の月のものか。前後の月の日は控えめに出す。 */
function inMonth(date: string): boolean {
  return monthOf(date) === month.value
}

function dayNumber(date: string): number {
  return Number(date.slice(8))
}

function goMonth(value: string) {
  void navigateTo({ query: { month: value } })
}

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

    <nav class="months">
      <button
        type="button"
        class="months__nav"
        aria-label="前の月"
        @click="goMonth(shiftAppMonth(month, -1))"
      >
        ‹
      </button>
      <strong class="months__label">{{ formatAppMonth(month) }}</strong>
      <button
        type="button"
        class="months__nav"
        aria-label="次の月"
        @click="goMonth(shiftAppMonth(month, 1))"
      >
        ›
      </button>
      <button
        v-if="month !== thisMonth"
        type="button"
        class="months__today"
        @click="goMonth(thisMonth)"
      >
        今月
      </button>
      <NuxtLink class="months__write" :to="`/diary/${today}`">
        今日の日記
      </NuxtLink>
    </nav>

    <p v-if="error" class="page__error" role="alert">
      日記を読み込めませんでした
    </p>

    <div class="calendar">
      <div
        v-for="(weekday, index) in WEEKDAYS"
        :key="weekday"
        class="calendar__weekday"
        :class="{
          'calendar__weekday--sun': index === 0,
          'calendar__weekday--sat': index === 6,
        }"
      >
        {{ weekday }}
      </div>

      <NuxtLink
        v-for="date in days"
        :key="date"
        class="day"
        :class="{
          'day--outside': !inMonth(date),
          'day--today': date === today,
          'day--written': byDate.has(date),
        }"
        :to="`/diary/${date}`"
        :aria-label="`${formatAppDate(date)}の日記${byDate.has(date) ? '（あり）' : ''}`"
      >
        <span class="day__number">{{ dayNumber(date) }}</span>
        <!--
          日記の有無は点で示す。枠に本文を詰めると、狭い画面で
          日付が読めなくなる。中身は下の一覧で読む
        -->
        <span v-if="byDate.has(date)" class="day__mark" aria-hidden="true" />
      </NuxtLink>
    </div>

    <p v-if="status === 'pending' && !diaries.length" class="page__placeholder">
      読み込み中…
    </p>

    <p v-else-if="!diaries.length" class="page__placeholder">
      {{ formatAppMonth(month) }}の日記はまだありません。
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

.months {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  /* 狭い画面では折り返す。横に伸びて画面からはみ出さないように */
  flex-wrap: wrap;
}

.months__nav {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 8px;
  color: inherit;
  /* タップ目標を確保する */
  min-width: 2.25rem;
  min-height: 2.25rem;
  font-size: 1.125rem;
  line-height: 1;
}

.months__label {
  font-size: 1rem;
  font-variant-numeric: tabular-nums;
  /* 月をまたいで幅が変わると、送りボタンの位置が動いてしまう */
  min-width: 5.5rem;
  text-align: center;
}

.months__today {
  background: transparent;
  border: 1px solid var(--border);
  border-radius: 999px;
  color: var(--text-muted);
  font-size: 0.8125rem;
  min-height: 2.25rem;
  padding: 0 0.75rem;
}

.months__write {
  margin-left: auto;
  background: var(--accent);
  border-radius: 999px;
  color: var(--accent-text);
  text-decoration: none;
  font-size: 0.875rem;
  font-weight: 600;
  min-height: 2.25rem;
  display: inline-flex;
  align-items: center;
  padding: 0 0.875rem;
}

.calendar {
  display: grid;
  grid-template-columns: repeat(7, 1fr);
  gap: 1px;
  background: var(--border);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  overflow: hidden;
}

.calendar__weekday {
  background: var(--bg);
  color: var(--text-muted);
  font-size: 0.75rem;
  text-align: center;
  padding: 0.25rem 0;
}

.calendar__weekday--sun {
  color: var(--danger);
}

.calendar__weekday--sat {
  color: var(--saturday);
}

.day {
  background: var(--surface);
  color: inherit;
  text-decoration: none;
  /*
   * 高さは固定し、月の日数（5週か6週か）で升目の大きさを変えない。
   * 縦横比で正方形にはしない。広い画面では縦に伸びすぎるうえ、
   * 幅も縦横比に合わせて縮み、列のあいだに隙間ができる
   */
  min-height: 3rem;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 0.1875rem;
  font-variant-numeric: tabular-nums;
}

.day__number {
  font-size: 0.875rem;
}

/* 日記のある日。点だけを置き、日付の読みやすさを保つ */
.day__mark {
  width: 0.375rem;
  height: 0.375rem;
  border-radius: 50%;
  background: var(--accent);
}

/* 前後の月の日。曜日の列を保つために出すが、当月とは区別する */
.day--outside {
  background: var(--bg);
  color: var(--text-muted);
}

.day--outside .day__mark {
  background: var(--text-muted);
}

.day--today {
  box-shadow: inset 0 0 0 2px var(--accent);
}

.day--today .day__number {
  font-weight: 700;
  color: var(--accent);
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
  padding: 1rem 0;
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
