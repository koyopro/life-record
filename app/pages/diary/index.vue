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
 *
 * 各日の枠には、本文の画像（あれば）か冒頭の文章をプレビューとして出す。
 * 枠が狭いと読みやすいプレビューにならないため、通常の画面幅より広げる。
 */
definePageMeta({ wide: true })

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

const store = useDiaryStore()

// 手元にある日記（IndexedDB）も抜粋に使う。オフラインでも書いた日が出る
onMounted(() => void store.loadAll())

const byDate = computed(
  () => new Map((diaries.value ?? []).map((entry) => [entry.date, entry])),
)

/**
 * その日に出すプレビュー。
 *
 * 一覧はサーバーから取るが、書いた直後はまだ古い内容が返る。手元に控えが
 * ある日は、そちらの答えを優先する（空にした日を「まだある」と出さないよう、
 * 控えがあるなら「無い」という答えも尊重する）。書いてから一覧へ戻ったときに
 * 編集前の抜粋が出ないようにするため（docs/15-client-state.md）。
 */
function previewOf(date: string): DiarySummaryDto | undefined {
  if (store.knows(date)) return store.summaryOf(date) ?? undefined
  return byDate.value.get(date)
}

interface DayCell {
  date: string
  preview?: DiarySummaryDto
}

const days = computed<DayCell[]>(() =>
  monthGrid(month.value).map((date) => ({ date, preview: previewOf(date) })),
)

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
        v-for="cell in days"
        :key="cell.date"
        class="day"
        :class="{
          'day--outside': !inMonth(cell.date),
          'day--today': cell.date === today,
          'day--written': cell.preview,
        }"
        :to="`/diary/${cell.date}`"
        :aria-label="`${formatAppDate(cell.date)}の日記${cell.preview ? '（あり）' : ''}`"
      >
        <span class="day__number">{{ dayNumber(cell.date) }}</span>
        <div v-if="cell.preview" class="day__preview">
          <img
            v-if="cell.preview.imageSrc"
            class="day__image"
            :src="cell.preview.imageSrc"
            alt=""
            loading="lazy"
          />
          <p v-else-if="cell.preview.excerpt" class="day__excerpt">
            {{ cell.preview.excerpt }}
          </p>
        </div>
      </NuxtLink>
    </div>

    <p v-if="status === 'pending' && !diaries.length" class="page__placeholder">
      読み込み中…
    </p>
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
  /* 各日の枠にプレビューを収める分の幅を確保する */
  max-width: 900px;
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
  min-height: 8rem;
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 0.25rem;
  padding: 0.375rem;
  font-variant-numeric: tabular-nums;
  overflow: hidden;
}

.day__number {
  align-self: flex-start;
  font-size: 0.8125rem;
  flex-shrink: 0;
}

/* 画像 or 冒頭の文章を、枠の残りいっぱいに収める */
.day__preview {
  flex: 1;
  min-height: 0;
  overflow: hidden;
  display: flex;
  /* 画像は 4:3 の高さで足りるので、下に余っても伸ばして引き延ばさない */
  align-items: flex-start;
}

.day__image {
  width: 100%;
  /* 横長 4:3 の枠に収め、縦が長い画像は下側を切り取る（上端は常に見せる） */
  aspect-ratio: 4 / 3;
  border-radius: 6px;
  object-fit: cover;
  object-position: top;
}

.day__excerpt {
  margin: 0;
  color: var(--text-muted);
  font-size: 0.6875rem;
  line-height: 1.4;
  white-space: pre-wrap;
  overflow: hidden;
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 6;
}

/* 前後の月の日。曜日の列を保つために出すが、当月とは区別する */
.day--outside {
  background: var(--bg);
  color: var(--text-muted);
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
</style>
