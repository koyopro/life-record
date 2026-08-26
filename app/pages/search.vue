<script setup lang="ts">
import {
  SEARCH_KINDS,
  SEARCH_KIND_LABELS,
  SEARCH_VIEWS,
  SEARCH_VIEW_LABELS,
  isSearchKind,
  type SearchHit,
  type SearchKind,
  type SearchView,
} from '~~/shared/types/search'
import { normalizeTagName } from '~~/shared/types/tag'
import { formatAppDate, isAppDate } from '~~/shared/utils/date'
import { formatDue } from '~/utils/due'
import { tagColorVar, tagTextColorVar } from '~/utils/tag-color'

/**
 * 横断検索（docs/03-functional-spec.md 3.6）。
 *
 * 条件は URL に置く。同じ検索に戻れるようにするため。
 */
const route = useRoute()
const router = useRouter()

useHead({ title: '検索' })

function queryString(key: string): string {
  const value = route.query[key]
  return typeof value === 'string' ? value : ''
}

const q = ref(queryString('q'))
const kind = computed<SearchKind>(() => {
  const value = route.query.kind
  return isSearchKind(value) ? value : 'all'
})
/**
 * タスクの表示方法（未完了 / 完了）。既定は未完了。
 *
 * 一覧（`ItemListView`）と同じ `?completed=true` で持つ。検索から
 * タスクを開いて一覧へ戻ったときに、同じ言葉が別の意味にならないように
 * するため。
 */
const view = computed<SearchView>(() =>
  route.query.completed === 'true' ? 'completed' : 'open',
)
const from = computed(() =>
  isAppDate(route.query.from) ? String(route.query.from) : '',
)
const to = computed(() => (isAppDate(route.query.to) ? String(route.query.to) : ''))

// タグでの絞り込み（docs/03-functional-spec.md 3.6）。一覧と同じく
// 名前で指定し、状態は URL に置く（docs/09-tags.md 9.3）。
// colorOf は結果のタグを一覧と同じ色で塗るのに使う
const { tags: allTags, colorOf } = useTags()

const tag = computed<string | undefined>(() => {
  const value = route.query.tag
  if (typeof value !== 'string') return undefined
  return normalizeTagName(value) ?? undefined
})

/** URL の条件を書き換える。履歴を汚さないよう replace を使う。 */
function setQuery(patch: Record<string, string | undefined>) {
  const next: Record<string, string> = { ...(route.query as Record<string, string>) }
  for (const [key, value] of Object.entries(patch)) {
    if (value) next[key] = value
    else delete next[key]
  }
  router.replace({ query: next })
}

// 打つたびに投げると無駄なので、手が止まってから URL に反映する
let timer: ReturnType<typeof setTimeout> | undefined
watch(q, (value) => {
  clearTimeout(timer)
  timer = setTimeout(() => setQuery({ q: value.trim() || undefined }), 300)
})

// 別の画面から `?q=` 付きで来たときに追随する
watch(
  () => queryString('q'),
  (value) => {
    if (value !== q.value) q.value = value
  },
)

// 条件は computed で渡す。useFetch はこれを見て投げ直す
const term = computed(() => queryString('q'))

const { data: hits, pending } = await useFetch<SearchHit[]>('/api/search', {
  query: { q: term, kind, view, tag, from, to },
  default: () => [],
})

/** 同じタグをもう一度押したら解除する（一覧と同じ）。 */
function selectTag(name: string) {
  setQuery({ tag: tag.value === name ? undefined : name })
}

/*
 * 日記にはタグが付かないため、タグで絞ると結果から外れる。
 *
 * 「未完了 / 完了」は常に効いている見方で、これで日記を外すと既定の検索から
 * 日記が丸ごと消えてしまうので、そちらでは外さない（日記は状態を持たない
 * まま、どちらの見方でも出る）。
 */
const excludedNote = computed(() =>
  kind.value === 'all' && tag.value
    ? 'タグで絞っているため、日記は結果に含めていません。'
    : '',
)

const hasQuery = computed(() => term.value.length > 0)

const input = ref<HTMLInputElement | null>(null)
onMounted(() => {
  // タッチ端末では、開いた瞬間にキーボードがせり上がると邪魔になる
  if (!window.matchMedia('(hover: none)').matches) input.value?.focus()
})

const KIND_LABELS: Record<Exclude<SearchKind, 'all'>, string> = {
  item: 'タスク',
  section: '作業記録',
  diary: '日記',
}

/**
 * 描くのに要るものを1行ぶんにまとめる。
 *
 * 期限も日付も、そのまま置くと1行につき何度も組み立て直すことになる
 * （表示するかの判定・色・文字で3回）。
 */
const rows = computed(() =>
  hits.value.map((hit) => ({
    hit,
    /*
     * 期限。一覧のカード（`ItemCard`）と同じ相対表現・同じ色にする。
     * 探し当てたタスクが、一覧で見ているのと同じ顔つきで並ぶようにするため。
     */
    due: hit.item ? formatDue(hit.item) : null,
    /*
     * 行の頭に出す日付。タスク名で当たった行は**作成日を出さない**。
     * いつ作ったかは探すときの手がかりにならず、右端の期限と2つの日付が
     * 並んで読み取りにくくなる。作業記録と日記の日付は、抜粋がいつ
     * 書かれたものかを示すので残す。
     */
    date: hit.kind === 'item' ? '' : formatAppDate(hit.date),
  })),
)
</script>

<template>
  <div class="page">
    <h1 class="page__title">検索</h1>

    <input
      ref="input"
      v-model="q"
      class="search"
      type="search"
      placeholder="タスク名・作業記録・日記から探す"
      aria-label="検索語"
    />

    <div class="filters">
      <div class="filters__row" role="group" aria-label="対象">
        <button
          v-for="value in SEARCH_KINDS"
          :key="value"
          type="button"
          class="chip"
          :class="{ 'chip--active': kind === value }"
          @click="setQuery({ kind: value === 'all' ? undefined : value })"
        >
          {{ SEARCH_KIND_LABELS[value] }}
        </button>
      </div>

      <div class="filters__row">
        <!--
          未完了 / 完了。一覧（ItemListView の list__bar）と同じ切り替えで、
          既定は未完了。片付いていないものを探すのが普段の使い方なので、
          完了したタスクが混じると目当てのものが埋もれる。
        -->
        <div class="view" role="group" aria-label="完了 / 未完了">
          <button
            v-for="value in SEARCH_VIEWS"
            :key="value"
            type="button"
            class="view__item"
            :class="{ 'view__item--active': view === value }"
            :aria-pressed="view === value"
            @click="setQuery({ completed: value === 'completed' ? 'true' : undefined })"
          >
            {{ SEARCH_VIEW_LABELS[value] }}
          </button>
        </div>

        <label class="filters__field">
          <span class="filters__label">期間</span>
          <input
            class="filters__date"
            type="date"
            :value="from"
            aria-label="開始日"
            @change="setQuery({ from: ($event.target as HTMLInputElement).value || undefined })"
          />
        </label>
        <label class="filters__field">
          <span class="filters__label">〜</span>
          <input
            class="filters__date"
            type="date"
            :value="to"
            aria-label="終了日"
            @change="setQuery({ to: ($event.target as HTMLInputElement).value || undefined })"
          />
        </label>
      </div>

      <nav v-if="allTags.length" class="tags" aria-label="タグで絞り込む">
        <button
          v-for="entry in allTags"
          :key="entry.id"
          type="button"
          class="tags__item"
          :class="{ 'tags__item--active': tag === entry.name }"
          :aria-pressed="tag === entry.name"
          @click="selectTag(entry.name)"
        >
          #{{ entry.name }}
        </button>
      </nav>
    </div>

    <p v-if="excludedNote" class="note">{{ excludedNote }}</p>

    <p v-if="!hasQuery" class="page__placeholder">
      探したい言葉を入れてください。
    </p>
    <p v-else-if="pending && !hits.length" class="page__placeholder">読み込み中…</p>
    <p v-else-if="!hits.length" class="page__placeholder">見つかりませんでした。</p>

    <!--
      タスクの行は、一覧のカード（ItemCard）と同じ読み取り方にする。
      左端の帯で重要度、タイトルの後ろにタグ、右端に期限。探し当てたものが
      一覧で見ているのと違う顔つきだと、同じタスクだと結び付けるのに一拍かかる。
    -->
    <ul v-else class="results">
      <li v-for="{ hit, due, date } in rows" :key="hit.id">
        <NuxtLink
          class="hit"
          :class="hit.item ? `hit--priority-${hit.item.priority ?? 'none'}` : undefined"
          :to="hit.path"
        >
          <div class="hit__head">
            <time v-if="date" class="hit__date" :datetime="hit.date">{{ date }}</time>
            <span class="hit__kind">{{ KIND_LABELS[hit.kind] }}</span>
          </div>

          <div class="hit__body">
            <span class="hit__title">{{ hit.title }}</span>
            <!--
              タグは押せない。行そのものが行き先へのリンクなので、中に別の
              押しどころを入れ子にできない（絞り込みは上のタグ行から）。
            -->
            <span
              v-for="name in hit.item?.tags ?? []"
              :key="name"
              class="hit__tag"
              :style="{
                '--tag-color': tagColorVar(colorOf(name)),
                '--tag-text': tagTextColorVar(colorOf(name)),
              }"
            >
              {{ name }}
            </span>
            <span
              v-if="due && due.state !== 'none'"
              class="hit__due"
              :class="`hit__due--${due.state}`"
            >
              {{ due.label }}
            </span>
          </div>

          <p v-if="hit.excerpt" class="hit__excerpt">{{ hit.excerpt }}</p>
        </NuxtLink>
      </li>
    </ul>
  </div>
</template>

<style scoped>
.page {
  display: grid;
  gap: 0.75rem;
}

.page__title {
  margin: 0;
  font-size: 1.25rem;
  font-weight: 700;
}

.page__placeholder {
  margin: 0;
  color: var(--text-muted);
  text-align: center;
  padding: 2rem 0;
}

.search {
  font: inherit;
  /* iOS でフォーカス時に自動ズームされないよう 16px を保つ */
  font-size: 1rem;
  width: 100%;
  min-height: 2.75rem;
  padding: 0 0.75rem;
  background: var(--surface);
  color: var(--text);
  border: 1px solid var(--border);
  border-radius: 8px;
}

.filters {
  display: grid;
  gap: 0.5rem;
}

.filters__row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.375rem;
}

.filters__field {
  display: flex;
  align-items: center;
  gap: 0.375rem;
}

.filters__label {
  color: var(--text-muted);
  font-size: 0.8125rem;
}

.filters__select,
.filters__date {
  font: inherit;
  font-size: 0.875rem;
  font-variant-numeric: tabular-nums;
  background: var(--surface);
  color: var(--text);
  border: 1px solid var(--border);
  border-radius: 8px;
  min-height: 2.25rem;
  padding: 0 0.5rem;
}

/* 未完了 / 完了。一覧の list__bar（app/components/ItemListView.vue）と同じ見た目 */
.view {
  display: flex;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 8px;
  overflow: hidden;
}

.view__item {
  background: transparent;
  border: 0;
  color: var(--text-muted);
  min-height: 2.25rem;
  padding: 0 0.625rem;
  font-size: 0.8125rem;
  white-space: nowrap;
}

.view__item--active {
  background: color-mix(in srgb, var(--accent) 14%, transparent);
  color: var(--accent);
  font-weight: 600;
}

.chip {
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 999px;
  color: var(--text);
  min-height: 2.25rem;
  padding: 0 0.75rem;
  font-size: 0.875rem;
}

.chip--active {
  background: var(--accent);
  border-color: var(--accent);
  color: var(--accent-text);
  font-weight: 600;
}

/* 一覧のタグ行と同じ見た目にする（app/components/ItemListView.vue） */
.tags {
  display: flex;
  gap: 0.25rem;
  overflow-x: auto;
  /* 横スクロールはしてよいが、スクロールバーは出さない */
  scrollbar-width: none;
}

.tags::-webkit-scrollbar {
  display: none;
}

.tags__item {
  background: transparent;
  border: 0;
  color: var(--text-muted);
  min-height: 2.25rem;
  padding: 0 0.375rem;
  white-space: nowrap;
  font-size: 0.8125rem;
}

.tags__item--active {
  color: var(--accent);
  font-weight: 600;
}

.note {
  margin: 0;
  color: var(--text-muted);
  font-size: 0.8125rem;
}

.results {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: 0.5rem;
}

.hit {
  position: relative;
  display: grid;
  gap: 0.1875rem;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  /* 左端は重要度の帯（::before）の場所を空ける */
  padding: 0.75rem 0.75rem 0.75rem 0.875rem;
  color: inherit;
  text-decoration: none;
}

/*
 * 重要度は左端の帯で示す（一覧のカードと同じ。docs/08-todo-management.md 8.1）。
 * 読まずに優先度が分かるようにするため。タスクに紐づかない行（日記）には
 * 付かないので、帯そのものを出さない。
 */
.hit--priority-none::before,
.hit--priority-1::before,
.hit--priority-2::before,
.hit--priority-3::before {
  content: '';
  position: absolute;
  left: 0.25rem;
  top: 0.5rem;
  bottom: 0.5rem;
  width: 3px;
  border-radius: 999px;
  background: var(--priority-none);
}

.hit--priority-1::before {
  background: var(--priority-1);
}

.hit--priority-2::before {
  background: var(--priority-2);
}

.hit--priority-3::before {
  background: var(--priority-3);
}

.hit__head {
  display: flex;
  align-items: baseline;
  gap: 0.5rem;
  color: var(--text-muted);
  font-size: 0.75rem;
}

.hit__date {
  font-variant-numeric: tabular-nums;
}

.hit__kind {
  border: 1px solid var(--border);
  border-radius: 999px;
  padding: 0 0.375rem;
}

/*
 * タイトル・タグ・期限を1行に並べる（一覧のカードに倣う）。入りきらない
 * ときだけ折り返し、期限は右端に寄せて、行のどこに出るかを一定にする。
 */
.hit__body {
  display: flex;
  align-items: baseline;
  flex-wrap: wrap;
  gap: 0.375rem;
  font-size: 0.9375rem;
}

.hit__title {
  font-weight: 600;
}

/* 一覧のタグ（ItemCard の card__tag）と同じ塗りつぶしピル */
.hit__tag {
  flex-shrink: 0;
  background: var(--tag-color);
  border-radius: 999px;
  padding: 0 0.375rem;
  color: var(--tag-text);
  font-size: 0.6875rem;
  font-weight: 600;
  line-height: 1.5;
  overflow-wrap: anywhere;
}

/* 期限は右端へ。色分けも一覧のカードと同じにする */
.hit__due {
  margin-left: auto;
  flex-shrink: 0;
  white-space: nowrap;
  color: var(--text-muted);
  font-size: 0.8125rem;
  font-variant-numeric: tabular-nums;
}

.hit__due--overdue {
  color: var(--danger);
  font-weight: 600;
}

.hit__due--today {
  color: var(--accent);
  font-weight: 600;
}

.hit__excerpt {
  margin: 0;
  color: var(--text-muted);
  font-size: 0.875rem;
  line-height: 1.6;
}
</style>
