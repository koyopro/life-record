<script setup lang="ts">
import type { DiaryDetailDto } from '~~/shared/types/diary'
import { STATUS_LABELS, type ItemDto } from '~~/shared/types/item'
import {
  formatAppDate,
  isAppDate,
  shiftAppDate,
  toAppDate,
} from '~~/shared/utils/date'
import { groupWorkedOn } from '~/utils/diary-worked-on'
import { startItemLinkDrag } from '~/utils/item-drag'

/**
 * 日付ごとの日記（docs/03-functional-spec.md 3.3）。
 *
 * 日付を変えたら作り直す。前の日の下書きを持ち越さないため。
 */
definePageMeta({ key: (route) => route.fullPath, wide: 'reading' })

const route = useRoute()
const date = computed(() => String(route.params.date))

if (!isAppDate(date.value)) {
  throw createError({ statusCode: 404, message: '日付が正しくありません' })
}

/*
 * top-level await にしない。待つと、日付を移るたびに画面遷移そのものが
 * 取得の完了までブロックされ、切り替えるたびにラグが出る。
 */
const { data: diary, error: fetchError, refresh } = useFetch<DiaryDetailDto>(
  () => `/api/diaries/${date.value}`,
)

/**
 * 日記は Item と違ってオフライン用の永続キャッシュ（IndexedDB）を持たないが、
 * セッション中に開いた日は控えておき、取得が終わるまでの間だけ初期表示に使う。
 * 正本はサーバーなので、届き次第 `diary`（本物）に切り替わる。
 * 初めて開く日は、控えが無いので届くまで読み込み中の表示になる。
 */
const diaryCache = useState<Record<string, DiaryDetailDto>>('diary-detail-cache', () => ({}))

watch(diary, (value) => {
  if (value) diaryCache.value[date.value] = value
})

const cachedDiary = computed(() => diary.value ?? diaryCache.value[date.value] ?? null)

/** 読み込めなかった。控えが出せているときは、それを優先して知らせない。 */
const error = computed(() => (cachedDiary.value ? null : fetchError.value))

useHead({ title: () => `${formatAppDate(date.value)}の日記` })

const today = toAppDate()
const isToday = computed(() => date.value === today)

// --- 本文（リアルタイム保存） ------------------------------------------

const bodyDraft = ref<string | null>(null)
const body = computed({
  get: () => bodyDraft.value ?? cachedDiary.value?.body ?? '',
  set: (value: string) => {
    bodyDraft.value = value
  },
})

const save = useAutosave({
  source: body,
  save: async (value) => {
    await $fetch(`/api/diaries/${date.value}`, {
      method: 'PUT',
      body: { body: value },
    })
  },
})

// 別の端末での変更や再取得に追随する。編集中の内容は上書きしない。
watch(cachedDiary, (value) => {
  if (!value) return
  if (save.state.value !== 'idle' && save.state.value !== 'saved') return
  if (value.body === body.value) return
  body.value = value.body
  save.markSynced()
})

// --- 日付の移動 ---------------------------------------------------------

/**
 * 別の日へ移る前に、書きかけを保存しておく。
 * 画面が作り直されるため、待たないと取りこぼす。
 */
async function goTo(next: string) {
  await save.flush()
  await navigateTo(`/diary/${next}`)
}

function onDateInput(event: Event) {
  const value = (event.target as HTMLInputElement).value
  if (!isAppDate(value) || value === date.value) return
  void goTo(value)
}

const workedOn = computed(() => cachedDiary.value?.items ?? [])

/**
 * 「この日にやったこと」を、完了したものと作業記録があるだけのものに分ける
 * （両方当てはまるものは完了した方に入れる）。
 */
const workedOnGroups = computed(() => groupWorkedOn(workedOn.value, date.value))

/**
 * 「この日にやったこと」から本文へドラッグしたら、開かずにリンクを差し込めるようにする。
 * 本文側（ScrapboxEditor）はカーソル位置にそのリンクを挿入する。
 */
function onWorkedOnDragStart(item: ItemDto, event: DragEvent) {
  startItemLinkDrag(event, { id: item.id, title: item.title })
}
</script>

<template>
  <div class="page">
    <p v-if="error" class="page__error" role="alert">
      日記を読み込めませんでした
    </p>

    <p v-else-if="!cachedDiary" class="page__placeholder">読み込み中…</p>

    <template v-else>
      <header class="head">
        <h1 class="head__title">{{ formatAppDate(date) }}</h1>
        <SaveDot class="head__save" :state="save.state.value" />
      </header>

      <nav class="nav" aria-label="日付">
        <button type="button" class="nav__button" @click="goTo(shiftAppDate(date, -1))">
          ← 前の日
        </button>
        <input
          class="nav__date"
          type="date"
          :value="date"
          aria-label="日付を選ぶ"
          @change="onDateInput"
        />
        <button
          type="button"
          class="nav__button"
          :disabled="isToday"
          @click="goTo(today)"
        >
          今日
        </button>
        <button type="button" class="nav__button" @click="goTo(shiftAppDate(date, 1))">
          次の日 →
        </button>
        <NuxtLink to="/diary" class="nav__link">一覧</NuxtLink>
      </nav>

      <ScrapboxEditor
        v-model="body"
        placeholder="今日のことを書く"
        aria-label="日記の本文"
      />
      <p v-if="save.errorMessage.value" class="page__error" role="alert">
        {{ save.errorMessage.value }}
      </p>

      <!--
        その日に作業した Item。Section の日付から導出し（docs/02-data-model.md 2.7）、
        完了したものとそれ以外に分けて出す（app/utils/diary-worked-on.ts）。
      -->
      <section
        v-for="group in workedOnGroups"
        :key="group.title"
        class="worked"
      >
        <h2 class="worked__title">{{ group.title }}</h2>
        <ul class="worked__list">
          <li v-for="item in group.items" :key="item.id">
            <NuxtLink
              class="worked__item"
              :to="`/items/${item.id}`"
              draggable="true"
              :aria-label="`「${item.title}」を本文へドラッグすると、リンクを挿入できます`"
              @dragstart="onWorkedOnDragStart(item, $event)"
            >
              <span class="worked__name">{{ item.title }}</span>
              <span class="worked__status">{{ STATUS_LABELS[item.status] }}</span>
            </NuxtLink>
          </li>
        </ul>
      </section>
    </template>
  </div>
</template>

<style scoped>
.page {
  display: grid;
  gap: 1rem;
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

.head {
  display: flex;
  align-items: baseline;
  gap: 0.625rem;
}

.head__title {
  margin: 0;
  font-size: 1.25rem;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}

.head__save {
  align-self: center;
}

.nav {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.375rem;
}

.nav__button {
  background: transparent;
  border: 1px solid var(--border);
  border-radius: 999px;
  color: var(--text);
  min-height: 2.25rem;
  padding: 0 0.75rem;
  font-size: 0.875rem;
}

.nav__button:disabled {
  opacity: 0.4;
}

.nav__date {
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

.nav__link {
  margin-left: auto;
  color: var(--text-muted);
  text-decoration: none;
  font-size: 0.875rem;
}

.worked {
  display: grid;
  gap: 0.5rem;
}

.worked__title {
  margin: 0;
  font-size: 0.8125rem;
  color: var(--text-muted);
  font-weight: 600;
}

.worked__list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: 0.25rem;
}

.worked__item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 0.5rem 0.75rem;
  min-height: 2.5rem;
  color: inherit;
  text-decoration: none;
  font-size: 0.875rem;
}

.worked__status {
  color: var(--text-muted);
  font-size: 0.8125rem;
  flex-shrink: 0;
}
</style>
