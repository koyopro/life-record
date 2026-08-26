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
import type { Shortcut } from '~/composables/useShortcuts'
import { formatDue } from '~/utils/due'
import { tagColorVar, tagTextColorVar } from '~/utils/tag-color'

/**
 * 横断検索（docs/03-functional-spec.md 3.6）。
 *
 * 条件は URL に置く。同じ検索に戻れるようにするため。
 */

// 結果の右側に詳細を並べるため、この画面もコンテナを広く使う（一覧と同じ）
definePageMeta({ wide: true })

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

/**
 * URL の条件を書き換える。履歴を汚さないよう replace を使う。
 *
 * 条件が変われば結果の中身も変わるので、右ペインに出していた選択
 * （`?selected=`）は持ち越さない。一覧（`ItemListView` の setFilter）と同じ。
 */
function setQuery(patch: Record<string, string | undefined>) {
  const next: Record<string, string> = { ...(route.query as Record<string, string>) }
  for (const [key, value] of Object.entries(patch)) {
    if (value) next[key] = value
    else delete next[key]
  }
  delete next.selected
  pinnedId.value = null
  router.replace({ query: next })
}

// 打つたびに投げると無駄なので、手が止まってから URL に反映する
let timer: ReturnType<typeof setTimeout> | undefined
watch(q, (value) => {
  clearTimeout(timer)
  timer = setTimeout(() => apply(value), 300)
})

function apply(value: string) {
  clearTimeout(timer)
  setQuery({ q: value.trim() || undefined })
}

/**
 * 入力欄で `Enter`（検索の実行）。
 *
 * 待たずに投げて、**入力欄からフォーカスを外す**。ここを離れて初めて
 * `j` / `k` が結果の行に効くようになる（入力欄にいる間、画面の割り当ては
 * 下がる。`isTypingTarget`）。打ち終わったら結果を見るのだから、そのまま
 * 送れるようにする。スマートフォンではキーボードも下がる。
 *
 * 日本語入力の変換を確定する `Enter` は拾わない（ItemComposer と同じ判定）。
 */
function onSearchKeydown(event: KeyboardEvent) {
  if (event.key !== 'Enter') return
  if (event.isComposing || event.keyCode === 229) return
  event.preventDefault()
  apply(q.value)
  ;(event.target as HTMLInputElement).blur()
}

// 別の画面から `?q=` 付きで来たときに追随する
watch(
  () => queryString('q'),
  (value) => {
    if (value !== q.value) q.value = value
  },
)

// 条件は computed で渡す。useFetch はこれを見て投げ直す
const term = computed(() => queryString('q'))

const { data: hits, pending, refresh } = await useFetch<SearchHit[]>('/api/search', {
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
    /** カーソル（useListCursor）が行を見分ける鍵。 */
    id: hit.id,
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

// --- カーソルと分割表示 -------------------------------------------------
//
// 一覧（ItemListView）と同じ形にする。`j` / `k` で結果を送り、広い画面では
// 左に結果・右にタスクの詳細を並べる。探した結果をその場で片付けられる
// ようにするため、いちいち詳細画面へ移らずに済ませたい。

const { cursor, cursorRow, moveCursor, focusRow, listEl } = useListCursor(rows)

const split = useSplitLayout()

/*
 * 画面の左端からのスワイプで左袖を引き出す。一覧を出している画面に付ける
 * （app/composables/useSidebarSwipe.ts）。
 */
useSidebarSwipe()

/**
 * カーソル以外から明示的に選んだタスク（行を押したとき）。
 *
 * 押した行とカーソルの行は普段そろっているが、押した直後に一覧が
 * 取り直されても選んだものが動かないよう、別に持つ（一覧と同じ）。
 */
const pinnedId = ref<string | null>(
  typeof route.query.selected === 'string' ? route.query.selected : null,
)

/** 右ペインに出すタスク。日記の行を指している間は無い。 */
const selectedId = computed(() =>
  split.value ? (pinnedId.value ?? cursorRow.value?.hit.item?.id ?? null) : null,
)

/**
 * 右ペインの枠を出すか。
 *
 * 出すものが無い行（日記）でも、行を指していれば枠は残す。結果には
 * タスクと日記が混ざるので、送るたびに枠が出たり消えたりすると幅が跳ねる。
 */
const detailOpen = computed(() => split.value && Boolean(cursorRow.value))

// カーソルが実際に動いたら、押して選んだものは解除してカーソルに追従させる
watch(
  () => cursorRow.value?.id,
  (id, previous) => {
    if (id && previous && id !== previous) pinnedId.value = null
  },
)

// 選択を URL に残す。再読み込みや共有で同じ状態に戻せるようにする
watch(selectedId, (id) => {
  const next = id ?? undefined
  if (route.query.selected === next) return
  const query = { ...route.query, selected: next }
  if (!next) delete query.selected
  router.replace({ query })
})

/**
 * 行を開く。広い画面のタスクは右ペインに出し、それ以外はそのページへ移る。
 *
 * 日記には埋め込める詳細が無いので、広い画面でもページを開く。
 */
function open(row: (typeof rows.value)[number]) {
  focusRow(row.id)
  if (split.value && row.hit.item) {
    pinnedId.value = row.hit.item.id
    return
  }
  void navigateTo(row.hit.path)
}

/**
 * 行を押した（マウス・指）。
 *
 * 行はリンクのままにしておき、右ペインで開けるときだけ遷移を止める。
 * ⌘ + クリックや中クリックで別タブに開けるようにしておきたいため。
 */
function onRowClick(row: (typeof rows.value)[number], event: MouseEvent) {
  focusRow(row.id)
  if (!split.value || !row.hit.item) return
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
  event.preventDefault()
  pinnedId.value = row.hit.item.id
}

/*
 * 結果の中を送るショートカット。一覧（ItemListView）と同じ打鍵にする。
 *
 * 中身を変える操作（完了・期限・タグ）はここには置かない。検索結果には
 * タスク以外も混ざるうえ、右ペインの詳細から同じことができる。
 */
const shortcuts = computed<Shortcut[]>(() => [
  {
    keys: ['j', 'ArrowDown'],
    display: 'j / ↓',
    label: '次の結果へ',
    group: '移動',
    run: () => moveCursor(1),
  },
  {
    keys: ['k', 'ArrowUp'],
    display: 'k / ↑',
    label: '前の結果へ',
    group: '移動',
    run: () => moveCursor(-1),
  },
  {
    keys: ['o', 'Enter'],
    display: 'o',
    label: '結果を開く',
    group: '移動',
    run: () => {
      const target = cursorRow.value
      if (target) open(target)
    },
  },
  {
    /*
     * 入力欄へ戻る。`Enter` で欄を離れたあと、キーボードだけで打ち直せる
     * ようにするため（どの検索でもだいたいこの割り当て）。
     */
    keys: ['/'],
    label: '検索語を打ち直す',
    group: '移動',
    run: () => {
      input.value?.focus()
      input.value?.select()
    },
  },
])

useShortcuts(shortcuts)
</script>

<template>
  <div class="page">
    <h1 class="page__title">検索</h1>

    <input
      ref="input"
      v-model="q"
      class="search"
      type="search"
      placeholder="タスク名・作業記録・日記から探す（Enter で結果へ）"
      aria-label="検索語"
      @keydown="onSearchKeydown"
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

    <!--
      結果（左）とタスクの詳細（右）。並べ方は一覧と同じ部品に任せる
      （app/components/ListDetailSplit.vue）。
    -->
    <ListDetailSplit :active="detailOpen">
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
      <ul v-else ref="listEl" class="results">
        <li v-for="(row, index) in rows" :key="row.id" :data-item-id="row.id">
          <NuxtLink
            class="hit"
            :class="[
              row.hit.item ? `hit--priority-${row.hit.item.priority ?? 'none'}` : '',
              { 'hit--focused': index === cursor },
            ]"
            :to="row.hit.path"
            @click="onRowClick(row, $event)"
          >
            <div class="hit__head">
              <time v-if="row.date" class="hit__date" :datetime="row.hit.date">
                {{ row.date }}
              </time>
              <span class="hit__kind">{{ KIND_LABELS[row.hit.kind] }}</span>
            </div>

            <div class="hit__body">
              <span class="hit__title">{{ row.hit.title }}</span>
              <!--
                タグは押せない。行そのものが行き先へのリンクなので、中に別の
                押しどころを入れ子にできない（絞り込みは上のタグ行から）。
              -->
              <span
                v-for="name in row.hit.item?.tags ?? []"
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
                v-if="row.due && row.due.state !== 'none'"
                class="hit__due"
                :class="`hit__due--${row.due.state}`"
              >
                {{ row.due.label }}
              </span>
            </div>

            <p v-if="row.hit.excerpt" class="hit__excerpt">{{ row.hit.excerpt }}</p>
          </NuxtLink>
        </li>
      </ul>

      <template #detail>
        <!-- id が変わったら作り直す。前のタスクの編集状態を持ち越さないため -->
        <ItemDetail
          v-if="selectedId"
          :key="selectedId"
          :item-id="selectedId"
          embedded
          @changed="refresh()"
        />
        <!--
          日記の行。埋め込める詳細が無いので、ここでは開かずページへ移る。
          枠だけは残す（送るたびに幅が跳ねないように）。
        -->
        <p v-else class="detail-note">日記はページを開いて読みます（<kbd>Enter</kbd>）。</p>
      </template>
    </ListDetailSplit>
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

/*
 * カーソル位置。キーボード操作の対象がどれかを、行の背景色で示す
 * （一覧のカードと同じ。`ItemCard` の card--focused）。
 */
.hit--focused {
  background: var(--cursor-bg);
  border-color: var(--accent);
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

/* 日記の行を指している間、右ペインに出す断り書き */
.detail-note {
  margin: 0;
  color: var(--text-muted);
  font-size: 0.875rem;
}

.detail-note kbd {
  font: inherit;
  border: 1px solid var(--border);
  border-radius: 4px;
  padding: 0 0.25rem;
}
</style>
