<script setup lang="ts">
import type { ItemDto } from '~~/shared/types/item'
import type { Shortcut } from '~/composables/useShortcuts'
import { formatAppDate, isAppDate, shiftAppDate } from '~~/shared/utils/date'
import { groupWorkedOn, PINNED_TITLE, UNTAGGED_TITLE } from '~/utils/diary-worked-on'
import { headOf } from '~~/shared/utils/diary'
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
const itemStore = useItemStore()

/*
 * top-level await にしない。待つと、日付を移るたびに画面遷移そのものが
 * 取得の完了までブロックされ、切り替えるたびにラグが出る。
 */
const { error: fetchError } = store.track(date)

/**
 * 画面に出す日記。
 *
 * 読むのはストア（＝IndexedDB の写し）だけにする。サーバーから取った内容も、
 * 書いた内容もそこへ入るので、書いてから別の日へ移って戻っても編集前の
 * 本文は出ない（docs/15-client-state.md）。オフラインでも、手元にある日は
 * そのまま読めて書ける（docs/12-offline.md）。
 */
const diary = computed(() => (store.knows(date.value) ? store.byDate(date.value) : null))

/** 読み込めなかった。手元に出せているときは、それを優先して知らせない。 */
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
  // 書いたものは手元（IndexedDB）と列に残っているので、送り終わるのは待たない
  store.flush()
  await navigateTo(path)
}

/** 別の日へ移る。 */
function goTo(next: string) {
  return leaveTo(`/diary/${next}`)
}

/*
 * 日付の移動はキーボードからも行えるようにする（`h` / `l`）。
 * 一覧の `j` / `k` と同じく vi の並びに合わせる。本文を書いている間は
 * 効かない（入力欄では無効。docs/08-todo-management.md 8.4）。
 */
useShortcuts(
  computed<Shortcut[]>(() => [
    {
      keys: ['h'],
      label: '前の日へ',
      group: '移動',
      run: () => goTo(shiftAppDate(date.value, -1)),
    },
    {
      keys: ['l'],
      label: '次の日へ',
      group: '移動',
      run: () => goTo(shiftAppDate(date.value, 1)),
    },
  ]),
)

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

/**
 * 「この日にやったこと」。手元の作業記録から作る（docs/02-data-model.md 2.8）。
 * サーバーから取り直したあとにも作り直す。
 */
const workedOn = computed(() => store.workedOnOf(date.value))

if (import.meta.client) {
  watch(
    [date, () => store.byDate(date.value), () => itemStore.items.value],
    () => void store.loadWorkedOn(date.value),
    { immediate: true },
  )
}

/**
 * 「この日にやったこと」をタグごとにまとめ、作業記録の冒頭を添える
 * （docs/03-functional-spec.md 3.3）。
 *
 * 出す形は描くたびに作り直さず、ここでまとめて整える。
 */
const workedOnGroups = computed(() =>
  groupWorkedOn(workedOn.value).map((group) => ({
    key: group.pinned ? '__pinned' : (group.tag ?? '__untagged'),
    tag: group.tag,
    pinned: group.pinned === true,
    title: group.pinned ? PINNED_TITLE : (group.tag ?? UNTAGGED_TITLE),
    records: group.records.map((record) => ({
      item: record.item,
      head: headOf(record.body),
      pinned: record.pinned === true,
      sectionIds: record.sectionIds ?? [],
      // グループの見出しに出ているタグは、行にも並べない
      // （ピン留めの見出しにはタグが出ないので、そのまま全部出す）
      tags: group.pinned
        ? record.item.tags
        : record.item.tags.filter((tag) => tag !== group.tag),
    })),
  })),
)

/**
 * 作業記録のピンを付け外しする（docs/03-functional-spec.md 3.3）。
 *
 * 留めたものは、その日の「この日にやったこと」の先頭にまとまって出る。
 * DB へ入るので、別のブラウザで開いても同じ並びになる。
 */
function togglePin(record: { pinned: boolean; sectionIds: string[] }) {
  if (record.sectionIds.length === 0) return
  return store.setPinned(date.value, record.sectionIds, !record.pinned)
}

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
        その日に作業した Item。Section の日付から導出し（docs/02-data-model.md 2.8）、
        タグごとにまとめて出す（app/utils/diary-worked-on.ts）。
      -->
      <section
        v-for="group in workedOnGroups"
        :key="group.key"
        class="worked"
      >
        <h2 class="worked__title">
          <span v-if="group.pinned">
            <span aria-hidden="true">📌</span> {{ group.title }}
          </span>
          <span
            v-else-if="group.tag"
            class="worked__tag"
            :style="{
              '--tag-color': tagColorVar(colorOf(group.tag)),
              '--tag-text': tagTextColorVar(colorOf(group.tag)),
            }"
          >
            {{ group.tag }}
          </span>
          <span v-else>{{ group.title }}</span>
        </h2>
        <ul class="worked__list">
          <li v-for="record in group.records" :key="record.item.id" class="worked__entry">
            <!--
              行とピンは並べて置く。リンクの中にボタンを入れると、押した先が
              どちらなのか（開くのか留めるのか）ブラウザ任せになる。
            -->
            <div class="worked__row">
              <NuxtLink
                class="worked__item"
                :to="`/items/${record.item.id}`"
                draggable="true"
                :aria-label="`「${record.item.title}」を本文へドラッグすると、リンクを挿入できます`"
                @dragstart="onWorkedOnDragStart(record.item, $event)"
              >
                <span class="worked__name">{{ record.item.title }}</span>
                <span v-if="record.tags.length" class="worked__tags">
                  <span
                    v-for="tag in record.tags"
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

              <button
                type="button"
                class="worked__pin"
                :class="{ 'worked__pin--on': record.pinned }"
                :aria-pressed="record.pinned"
                :aria-label="
                  record.pinned
                    ? `「${record.item.title}」のピン留めを外す`
                    : `「${record.item.title}」をピン留めする`
                "
                :title="record.pinned ? 'ピン留めを外す' : 'ピン留めする'"
                @click="togglePin(record)"
              >
                <span aria-hidden="true">📌</span>
              </button>
            </div>

            <!-- その日の作業記録の冒頭だけ。続きは Item 詳細で読む -->
            <div v-if="record.head.text" class="worked__body">
              <ScrapboxEditor
                view
                :model-value="record.head.text"
                :aria-label="`「${record.item.title}」の作業記録`"
              />
              <p v-if="record.head.truncated" class="worked__more">…</p>
            </div>
          </li>
        </ul>
      </section>
    </template>
  </div>
</template>

<style scoped>
.page {
  display: grid;
  /*
   * 列は必ず親の幅に収める。既定（auto）だと、中身のいちばん広いものの
   * 最小幅まで列が広がり、狭い端末ではページが横スクロールする。
   */
  grid-template-columns: minmax(0, 1fr);
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
  min-width: 0;
  font-size: 1.25rem;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  /* 入りきらないときは日付が縮む。前後のボタンを押し出さないため */
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
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
  display: flex;
  align-items: center;
  gap: 0.375rem;
  font-size: 0.8125rem;
  color: var(--text-muted);
  font-weight: 600;
}

.worked__list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: 0.5rem;
}

.worked__entry {
  display: grid;
  gap: 0.25rem;
  min-width: 0;
}

/* 行（リンク）とピンのボタンを横に並べる */
.worked__row {
  display: flex;
  align-items: stretch;
  gap: 0.375rem;
  min-width: 0;
}

/*
 * ピン留めのボタン。
 *
 * 触れたときだけ出す形にはしない。指で操作する画面では「触れた」が
 * そのまま押したことになり、出す機会が無いため。留めていない間は薄くして、
 * 読むときの邪魔にならないようにする。
 */
.worked__pin {
  flex: 0 0 auto;
  width: 2.25rem;
  display: grid;
  place-items: center;
  padding: 0;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--surface);
  font-size: 0.875rem;
  line-height: 1;
  opacity: 0.4;
}

.worked__pin:hover {
  opacity: 0.8;
}

/* 留めているものは、はっきり分かるようにする */
.worked__pin--on {
  opacity: 1;
  border-color: var(--accent);
  background: color-mix(in srgb, var(--accent) 14%, var(--surface));
}

/* 作業記録は本文より控えめに。日記そのものを読む邪魔にならないようにする */
.worked__body {
  padding-left: 0.75rem;
  border-left: 2px solid var(--border);
  font-size: 0.875rem;
  color: var(--text-muted);
  min-width: 0;
}

.worked__more {
  margin: 0;
  color: var(--text-muted);
  font-size: 0.875rem;
  line-height: 1;
}

.worked__item {
  flex: 1 1 auto;
  display: flex;
  align-items: center;
  justify-content: space-between;
  /* タグまで入りきらないときは、タグを次の行へ送る */
  flex-wrap: wrap;
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

/*
 * 長いタイトルは画面の幅で折り返す。
 *
 * 1行に収めて端を省略すると、そのぶん行の最小幅がタイトルの長さになり、
 * ページごと横に広がってしまう（読めない上に横スクロールが出る）。
 */
.worked__name {
  flex: 1 1 auto;
  min-width: 0;
  overflow-wrap: anywhere;
}

.worked__tags {
  display: flex;
  /* タグが多いときは、タグどうしも折り返す */
  flex-wrap: wrap;
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
