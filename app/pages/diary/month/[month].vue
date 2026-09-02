<script setup lang="ts">
import type { DiarySummaryDto } from '~~/shared/types/diary'
import type { Backlink } from '~~/shared/types/backlink'
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
import { diaryMonthPath } from '~~/shared/utils/diary-month'
import { buildItemDraft } from '~/utils/item-draft'
import { writeToClipboard } from '~/utils/clipboard'

/**
 * 月のページ（docs/03-functional-spec.md 3.3）。
 *
 * 日記の一覧をカレンダーで見せる。縦に並べるだけだと、書いていない日が
 * 詰められて見えず、どこが空いているのか分からない。
 *
 * 各日の枠には、本文の画像（あれば）か冒頭の文章をプレビューとして出す。
 * 枠が狭いと読みやすいプレビューにならないため、通常の画面幅より広げる。
 *
 * 月そのものにアドレス（`/diary/month/YYYY-MM`）を与えてあるので、本文から
 * リンクで指せる。指してきた本文は「この月を指しているもの」として下に
 * 並べる（docs/11-scrapbox-notation.md 11.11）。月の振り返りを書いたタスクと
 * 月のページが、これだけで相互に行き来できる。
 *
 * `/diary/[date]` より先にこの経路が選ばれる（Nuxt は静的な区間を優先する。
 * `/diary/today` と同じ）。
 */
definePageMeta({ key: (route) => route.fullPath, wide: true })

const route = useRoute()
const month = computed(() => String(route.params.month))

if (!isAppMonth(month.value)) {
  throw createError({ statusCode: 404, message: '月が正しくありません' })
}

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

useHead({ title: computed(() => `${formatAppMonth(month.value)}の日記`) })

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
  const remote = byDate.value.get(date)
  if (!store.knows(date)) return remote

  const local = store.summaryOf(date)

  /*
   * ピン留めの画像だけは、手元に無ければサーバーの答えを使う。
   *
   * その日の作業記録は「この端末で開いたことのある日」しか手元に無い
   * （docs/12-offline.md 12.4）。本文と同じように手元だけを見ると、開いた
   * ことのない日のサムネイルが消える。本文（抜粋・本文中の画像）は
   * これまでどおり手元の控えが正。
   */
  const pinnedImageSrc = local?.pinnedImageSrc ?? remote?.pinnedImageSrc ?? null

  if (!local) {
    // 本文を消した日でも、ピン留めがあれば目印として残す
    return pinnedImageSrc
      ? { date, excerpt: '', imageSrc: null, pinnedImageSrc }
      : undefined
  }

  return { ...local, pinnedImageSrc }
}

/** サムネイル。本文の画像が無ければ、ピン留めした作業記録の画像を使う。 */
function thumbnailOf(preview: DiarySummaryDto): string | null {
  return preview.imageSrc ?? preview.pinnedImageSrc
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

function onDateInput(event: Event) {
  const value = (event.target as HTMLInputElement).value
  if (!isAppDate(value)) return
  void navigateTo(`/diary/${value}`)
}

// --- この月を指しているもの（バックリンク） -----------------------------

/** この月のページのパス。本文にこれを書いたものが、下に並ぶ。 */
const path = computed(() => diaryMonthPath(month.value))

/*
 * バックリンクはサーバーの部分一致検索に頼っており、手元には無い
 * （検索と同じ制約。docs/12-offline.md）。オフラインでは空で出す。
 */
const {
  data: backlinks,
  status: backlinkStatus,
  refresh: refreshBacklinks,
} = useFetch<Backlink[]>('/api/backlinks', {
  query: computed(() => ({ path: path.value })),
  default: () => [],
})

const KIND_LABELS: Record<Backlink['kind'], string> = {
  item: 'メモ',
  section: '作業記録',
  diary: '日記',
}

const itemStore = useItemStore()
const creating = ref(false)
const createFailed = ref<string | null>(null)

/**
 * この月の振り返りタスクを作る。
 *
 * 題とリンクを毎回打つのを省くためだけの近道で、専用の構造は持たない。
 * できるのは「メモの1行目にこの月へのリンクが入った、ただのタスク」で、
 * 手で作ったものと区別はない。
 */
async function createRetrospective() {
  if (creating.value) return
  creating.value = true
  createFailed.value = null

  try {
    const title = `${formatAppMonth(month.value)}の振り返り`
    const built = buildItemDraft(title)
    if ('error' in built) {
      createFailed.value = built.error
      return
    }

    const { draft } = built
    await itemStore.create(draft, title)
    // リンクはメモに置く。日付を持たない「このタスクが何の話か」であって、
    // その日にやったことではないため（docs/02-data-model.md 2.3）
    await itemStore.patch([draft.id], { note: `[${path.value}]` })

    await navigateTo(`/items/${draft.id}`)
  } catch {
    createFailed.value = '振り返りを作れませんでした'
  } finally {
    creating.value = false
  }
}

/**
 * この月へのリンクの記法をクリップボードへ写す。
 *
 * 既にあるタスクのメモへ貼るための近道。打つと長いうえ、`month/` の
 * 位置を間違えるとただの文字列になってしまう（記法として認識されない）。
 *
 * 新しく作るなら「振り返りを作る」、書きながらなら `Ctrl` + `T` を続けて
 * 3回（docs/11-scrapbox-notation.md 11.11）。こちらはその2つで届かない
 * 「別の月を、既にあるタスクから指す」ためにある。
 */
const copied = ref(false)
let copiedTimer: ReturnType<typeof setTimeout> | null = null

async function copyLink() {
  if (!(await writeToClipboard(`[${path.value}]`))) return

  copied.value = true
  if (copiedTimer) clearTimeout(copiedTimer)
  copiedTimer = setTimeout(() => {
    copied.value = false
  }, 1500)
}

onUnmounted(() => {
  if (copiedTimer) clearTimeout(copiedTimer)
})

/*
 * 振り返りを作って戻ってきたときに、下の一覧へ出るようにする。バック
 * リンクはサーバーが本文から引き直すので、送信が済むまでは現れない。
 */
onActivated(() => void refreshBacklinks())
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
      <NuxtLink
        class="months__nav"
        aria-label="前の月"
        :to="diaryMonthPath(shiftAppMonth(month, -1))"
      >
        ‹
      </NuxtLink>
      <strong class="months__label">{{ formatAppMonth(month) }}</strong>
      <NuxtLink
        class="months__nav"
        aria-label="次の月"
        :to="diaryMonthPath(shiftAppMonth(month, 1))"
      >
        ›
      </NuxtLink>
      <NuxtLink
        v-if="month !== thisMonth"
        class="months__today"
        :to="diaryMonthPath(thisMonth)"
      >
        今月
      </NuxtLink>
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
            v-if="thumbnailOf(cell.preview)"
            class="day__image"
            :src="thumbnailOf(cell.preview)!"
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

    <!--
      この月を指している本文。中間テーブルは持たず、本文に書かれた
      リンクをサーバーが引き直して並べる（docs/11-scrapbox-notation.md 11.11）
    -->
    <section class="links">
      <header class="links__head">
        <h2 class="links__title">この月を指しているもの</h2>
        <div class="links__actions">
          <button type="button" class="links__button" @click="copyLink">
            {{ copied ? 'コピーした' : 'リンクをコピー' }}
          </button>
          <button
            type="button"
            class="links__button"
            :disabled="creating"
            @click="createRetrospective"
          >
            {{ creating ? '作成中…' : '振り返りを作る' }}
          </button>
        </div>
      </header>

      <p v-if="createFailed" class="page__error" role="alert">{{ createFailed }}</p>

      <ul v-if="backlinks.length" class="links__list">
        <li v-for="link in backlinks" :key="link.id" class="link">
          <NuxtLink class="link__body" :to="link.path">
            <span class="link__kind">{{ KIND_LABELS[link.kind] }}</span>
            <span class="link__title">{{ link.title }}</span>
            <span v-if="link.kind !== 'item'" class="link__date">
              {{ formatAppDate(link.date) }}
            </span>
            <span v-if="link.excerpt" class="link__excerpt">{{ link.excerpt }}</span>
          </NuxtLink>
        </li>
      </ul>

      <p v-else-if="backlinkStatus === 'pending'" class="page__placeholder">
        読み込み中…
      </p>

      <p v-else class="links__empty">
        まだありません。本文に <code>[{{ path }}]</code> と書くと、ここに出る。
      </p>
    </section>
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
  text-decoration: none;
  /* タップ目標を確保する */
  min-width: 2.25rem;
  min-height: 2.25rem;
  display: inline-flex;
  align-items: center;
  justify-content: center;
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
  text-decoration: none;
  font-size: 0.8125rem;
  min-height: 2.25rem;
  display: inline-flex;
  align-items: center;
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

/* この月を指しているもの。カレンダーと同じ幅に収める */
.links {
  display: grid;
  gap: 0.5rem;
  max-width: 900px;
}

.links__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
}

.links__title {
  margin: 0;
  font-size: 0.875rem;
  font-weight: 700;
  color: var(--text-muted);
}

.links__actions {
  display: flex;
  align-items: center;
  gap: 0.375rem;
}

.links__button {
  background: transparent;
  border: 1px solid var(--border);
  border-radius: 999px;
  color: var(--text-muted);
  font-size: 0.8125rem;
  min-height: 2.25rem;
  padding: 0 0.75rem;
  white-space: nowrap;
}

.links__button:disabled {
  opacity: 0.6;
}

.links__list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: 1px;
  background: var(--border);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  overflow: hidden;
}

.link__body {
  background: var(--surface);
  color: inherit;
  text-decoration: none;
  display: flex;
  align-items: baseline;
  flex-wrap: wrap;
  gap: 0.5rem;
  padding: 0.5rem 0.625rem;
}

.link__kind {
  color: var(--text-muted);
  font-size: 0.6875rem;
  border: 1px solid var(--border);
  border-radius: 999px;
  padding: 0 0.375rem;
  flex-shrink: 0;
}

.link__title {
  font-size: 0.875rem;
  font-weight: 600;
}

.link__date {
  color: var(--text-muted);
  font-size: 0.75rem;
  font-variant-numeric: tabular-nums;
}

.link__excerpt {
  color: var(--text-muted);
  font-size: 0.75rem;
  /* 抜粋は行を折らず、幅に収まらないぶんは省く */
  flex: 1 1 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.links__empty {
  margin: 0;
  color: var(--text-muted);
  font-size: 0.8125rem;
}

.links__empty code {
  font-size: 0.75rem;
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
