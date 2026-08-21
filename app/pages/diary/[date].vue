<script setup lang="ts">
import type { ItemDto } from '~~/shared/types/item'
import { formatAppDate, isAppDate, shiftAppDate } from '~~/shared/utils/date'
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

const store = useDiaryStore()

/*
 * top-level await にしない。待つと、日付を移るたびに画面遷移そのものが
 * 取得の完了までブロックされ、切り替えるたびにラグが出る。
 */
const { error: fetchError } = store.track(date)

/**
 * 画面に出す日記。
 *
 * 読むのはストアの控えだけにする。サーバーから取った内容も、書いた内容も
 * そこへ入るので、書いてから別の日へ移って戻っても編集前の本文は出ない
 * （docs/15-client-state.md）。初めて開く日は、控えが無いので届くまで
 * 読み込み中の表示になる。
 */
const diary = computed(() => store.byDate(date.value))

/** 読み込めなかった。控えが出せているときは、それを優先して知らせない。 */
const error = computed(() => (diary.value ? null : fetchError.value))

useHead({ title: () => `${formatAppDate(date.value)}の日記` })

// --- 本文（リアルタイム保存） ------------------------------------------
//
// 打鍵はそのままストアへ渡す。控えが即座に変わり、サーバーへの送信だけが
// 遅れて裏で走る。下書きを画面側に持たないので、書きかけのまま画面を
// 離れても内容は残る。

const body = computed({
  get: () => store.bodyOf(date.value),
  set: (value: string) => store.editBody(date.value, value),
})

const save = computed(() => store.statusOf(date.value))

// --- 日付の移動 ---------------------------------------------------------

/**
 * 日記の画面から離れる前に、書きかけを保存しておく。
 * 画面が作り直されるため、待たないと取りこぼす。
 */
async function leaveTo(path: string) {
  await store.flush(date.value)
  await navigateTo(path)
}

/** 別の日へ移る。 */
function goTo(next: string) {
  return leaveTo(`/diary/${next}`)
}

/**
 * カレンダー（日記の一覧）へ移る。
 *
 * 任意の日付を選ぶのはこちらに任せる。ヘッダーは1行に収めたいので、
 * 日付の入力欄は置かない。
 */
function goToCalendar() {
  return leaveTo('/diary')
}

const { colorOf } = useTags()

const workedOn = computed(() => diary.value?.items ?? [])

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

    <p v-else-if="!diary" class="page__placeholder">読み込み中…</p>

    <template v-else>
      <!--
        日付と移動を1行に収める。狭い画面では前後の移動を矢印だけにする
        （文字まで入れると日付が折り返し、2行に増えてしまう）。
      -->
      <header class="head">
        <button
          type="button"
          class="head__step"
          aria-label="前の日へ"
          @click="goTo(shiftAppDate(date, -1))"
        >
          <span aria-hidden="true">←</span>
          <span class="head__step-label">前の日</span>
        </button>

        <!-- 日付・保存状態・カレンダーは1組にして中央に置く -->
        <div class="head__current">
          <h1 class="head__title">{{ formatAppDate(date) }}</h1>
          <SaveDot :state="save.state" />
          <!-- 任意の日付へはカレンダーから移る（日付の入力欄は置かない） -->
          <button
            type="button"
            class="head__calendar"
            aria-label="日記のカレンダーへ"
            @click="goToCalendar"
          >
            <span aria-hidden="true">🗓️</span>
          </button>
        </div>

        <button
          type="button"
          class="head__step"
          aria-label="次の日へ"
          @click="goTo(shiftAppDate(date, 1))"
        >
          <span class="head__step-label">次の日</span>
          <span aria-hidden="true">→</span>
        </button>
      </header>

      <ScrapboxEditor
        v-model="body"
        placeholder="今日のことを書く"
        aria-label="日記の本文"
      />
      <p v-if="save.error" class="page__error" role="alert">
        {{ save.error }}
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
              <span v-if="item.tags.length" class="worked__tags">
                <span
                  v-for="tag in item.tags"
                  :key="tag"
                  class="worked__tag"
                  :style="{
                    '--tag-color': tagColorVar(colorOf(tag)),
                    '--tag-text': tagTextColorVar(colorOf(tag)),
                  }"
                >
                  {{ tag }}
                </span>
              </span>
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

/*
 * 日付と移動の1行。前後の移動を両端に置き、日付はその間に置く。
 * 折り返さない（flex-wrap を使わない）ことでどの幅でも1行に収める。
 */
.head {
  display: flex;
  align-items: center;
  gap: 0.375rem;
}

/* 余った幅はこの組が持つ。前後のボタンは両端に残る */
.head__current {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.375rem;
}

.head__title {
  margin: 0;
  font-size: 1.25rem;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.head__step,
.head__calendar {
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
  background: transparent;
  border: 1px solid var(--border);
  border-radius: 999px;
  color: var(--text);
  /* タップ目標として十分な大きさを確保する */
  min-height: 2.25rem;
  padding: 0 0.75rem;
  font-size: 0.875rem;
  white-space: nowrap;
}

.head__calendar {
  padding: 0 0.5rem;
  font-size: 1rem;
  line-height: 1;
}

/* 狭い画面では矢印だけにする。文字まで入れると日付が押し出される */
@media (max-width: 30rem) {
  .head__step-label {
    display: none;
  }

  .head__step {
    padding: 0 0.625rem;
  }

  .head__title {
    font-size: 1.125rem;
  }
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

.worked__name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.worked__tags {
  display: flex;
  gap: 0.375rem;
  flex-shrink: 0;
}

.worked__tag {
  background: var(--tag-color);
  color: var(--tag-text);
  font-size: 0.75rem;
  font-weight: 600;
  line-height: 1.6;
  border-radius: 999px;
  padding: 0.0625rem 0.5rem;
}
</style>
