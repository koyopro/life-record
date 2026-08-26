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
// 名前で指定し、状態は URL に置く（docs/09-tags.md 9.3）
const { tags: allTags } = useTags()

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
  if (window.matchMedia('(hover: none)').matches) return
  /*
   * すでに結果が出ている状態で開いたとき（`?q=` 付きのリンク、戻ってきた
   * とき）は、入力欄へ入れない。読みたいのは結果のほうで、ここに
   * フォーカスがあると `j` / `k` が打てない。打ち直すときは `/` で戻る。
   */
  if (hasQuery.value) return
  input.value?.focus()
})

const KIND_LABELS: Record<Exclude<SearchKind, 'all'>, string> = {
  item: 'タスク',
  section: '作業記録',
  diary: '日記',
}

const itemStore = useItemStore()

/**
 * 検索の当たりを、一覧に並んでいるのと同じ Item に置き換える。
 *
 * カード（`ItemCard`）も操作（`ItemActions`）も一覧と共通にするので、
 * **手元（IndexedDB）の Item そのもの**を渡す。応答をそのまま描くと、
 * 完了にしたりタグを外したりしても結果の行が古いままになる。
 *
 * まだ手元に無いとき（他の端末で作られた直後など）は、応答から最小限を
 * 組み立てて出す。並べるものが消えるよりは、読めるほうがよい。
 */
function itemOf(hit: SearchHit): ItemDto | null {
  if (!hit.item) return null

  const local = itemStore.byId(hit.item.id)
  if (local) return local

  return {
    ...hit.item,
    title: hit.title,
    url: null,
    body: null,
    recurrenceRule: null,
    recurrenceBasis: null,
    seriesId: null,
    completedAt: null,
    createdAt: hit.date,
    updatedAt: hit.date,
  }
}

/**
 * 描くのに要るものを1行ぶんにまとめる。
 *
 * 手元の Item を引き当てるのも日付を組み立てるのも、そのまま置くと
 * 1行につき何度も繰り返すことになる。
 */
const rows = computed(() =>
  hits.value.map((hit) => ({
    /** カーソル（useListCursor）が行を見分ける鍵。 */
    id: hit.id,
    hit,
    /** カードに渡すタスク。日記の行では null。 */
    item: itemOf(hit),
    /*
     * 行に添える日付。タスク名で当たった行は**作成日を出さない**。
     * いつ作ったかは探すときの手がかりにならず、カード右端の期限と
     * 2つの日付が並んで読み取りにくくなる。作業記録と日記の日付は、
     * 抜粋がいつ書かれたものかを示すので残す。
     */
    date: hit.kind === 'item' ? '' : formatAppDate(hit.date),
  })),
)

/** 結果に出てくるタスクの id（出てきた順、重複を除く）。 */
const taskIds = computed(() => [
  ...new Set(hits.value.flatMap((hit) => (hit.item ? [hit.item.id] : []))),
])

// --- カーソルと分割表示 -------------------------------------------------
//
// 一覧（ItemListView）と同じ形にする。`j` / `k` で結果を送り、広い画面では
// 左に結果・右にタスクの詳細を並べる。探した結果をその場で片付けられる
// ようにするため、いちいち詳細画面へ移らずに済ませたい。

const { cursor, cursorRow, moveCursor, focusRow, listEl } = useListCursor(rows)

/** カーソルが指しているタスク。日記の行にいる間は null（操作の対象も空になる）。 */
const focusedItemId = computed(() => cursorRow.value?.hit.item?.id ?? null)

/**
 * 一覧とまったく同じ操作を、検索結果に対しても効かせる。
 *
 * 絞り込みは検索（サーバー）が済ませているので、出す Item は id で直に渡す。
 * カーソルは行の側（`useListCursor`）が持ち、タスクを指している間だけ
 * ここへ届く。あとは選択も編集も取り消しも、一覧と同じ道具がそのまま働く。
 */
const list = useItemList({
  status: 'all',
  external: { ids: taskIds, focusedId: focusedItemId },
})

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

/** 右ペインに出す日記の日付。タスクの行を指している間は無い。 */
const selectedDiaryDate = computed(() => {
  const row = cursorRow.value
  return split.value && row && row.hit.kind === 'diary' ? row.hit.date : null
})

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

type Row = (typeof rows.value)[number]

/**
 * 行を開く。広い画面のタスクは右ペインに出し、それ以外はそのページへ移る。
 */
function open(row: Row) {
  focusRow(row.id)
  if (split.value && row.hit.item) {
    pinnedId.value = row.hit.item.id
    return
  }
  void navigateTo(row.hit.path)
}

/**
 * タスクを開く（`ItemActions` から。操作シートの「詳細を開く」）。
 *
 * 行からの `open` と違い、渡ってくるのは Item そのもの。行き先の決め方は
 * 同じで、広い画面なら右ペイン、狭ければ詳細画面。
 */
function openItem(item: ItemDto) {
  if (split.value) {
    pinnedId.value = item.id
    return
  }
  void navigateTo(`/items/${item.id}`)
}

/**
 * 日記の行を押した（マウス・指）。
 *
 * 行はリンクのままにしておき、右ペインで読めるときだけ遷移を止める。
 * ⌘ + クリックや中クリックで別タブに開けるようにしておきたいため。
 */
function onDiaryClick(row: Row, event: MouseEvent) {
  focusRow(row.id)
  if (!split.value) return
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
  event.preventDefault()
}

/**
 * チェックの四角を押した。
 *
 * 一覧と同じく、チェックと合わせて**カーソルもその行へ動かす**。押した行が
 * 色付きにならないと、続けて押すキー操作の起点が読み取れない。
 */
function selectRow(row: Row) {
  focusRow(row.id)
  if (row.hit.item) list.toggleSelect(row.hit.item.id)
}

/**
 * タスクを開いたうえで、詳細の欄へ移る（`r` / `u` / `y`）。
 *
 * 右ペインが出ていればその欄へ。出ていない狭い画面では、編集できる場所が
 * 詳細画面しかないのでそちらへ移動し、どこへ入りたかったかを URL で渡す
 * （一覧と同じ。docs/08-todo-management.md 8.4）。
 */
const FOCUS_QUERY = { Title: 'title', Url: 'url', Body: 'body' } as const

const detail = ref<{
  focusTitle: () => void
  focusUrl: () => void | Promise<void>
  focusBody: () => void
} | null>(null)

async function focusDetail(field: 'Title' | 'Url' | 'Body') {
  const target = list.cursorItem.value
  if (!target) return

  if (!split.value) {
    await navigateTo({
      path: `/items/${target.id}`,
      query: { focus: FOCUS_QUERY[field] },
    })
    return
  }

  pinnedId.value = target.id
  await nextTick()
  detail.value?.[`focus${field}`]()
}

/** タスクへの操作（`ItemActions`）。カードのスワイプ・長押しをそちらへ渡す。 */
const actions = ref<{
  toggleComplete: (item: ItemDto) => void
  openSheet: (item: ItemDto) => void
} | null>(null)

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
        タスクの行は、一覧とまったく同じカード（ItemCard）で出す。探し当てた
        ものが一覧で見ているのと違う顔つきだと、同じタスクだと結び付けるのに
        一拍かかるうえ、そこからできることも別に覚えることになる。
      -->
      <div
        v-else
        ref="listEl"
        class="results"
        :class="{ 'results--selecting': list.selectedIds.value.size }"
      >
        <div
          v-for="(row, index) in rows"
          :key="row.id"
          class="row"
          :class="{ 'row--noted': row.item && row.hit.excerpt }"
          :data-item-id="row.id"
        >
          <ItemCard
            v-if="row.item"
            :item="row.item"
            :focused="index === cursor"
            :selected="list.selectedIds.value.has(row.item.id)"
            @focus="focusRow(row.id)"
            @select="selectRow(row)"
            @complete="actions?.toggleComplete(row.item)"
            @open="open(row)"
            @longpress="actions?.openSheet(row.item)"
            @filter-tag="selectTag"
          />

          <!--
            日記の行。カードと同じ密度で並べるが、左端の帯・チェック・期限は
            出さない（どれも Item に付くもので、日記は持たない）。
          -->
          <NuxtLink
            v-else
            class="diary-hit"
            :class="{ 'diary-hit--focused': index === cursor }"
            :to="row.hit.path"
            @click="onDiaryClick(row, $event)"
          >
            <span class="diary-hit__date">{{ row.date }}</span>
            <span class="diary-hit__kind">日記</span>
            <span class="diary-hit__excerpt">{{ row.hit.excerpt }}</span>
          </NuxtLink>

          <!--
            作業記録で当たった行。何がどこに書いてあって当たったのかは、
            カードだけでは分からないので下に添える。
          -->
          <p v-if="row.item && row.hit.excerpt" class="note-line">
            <span class="note-line__date">{{ row.date }}</span>
            <span class="note-line__kind">{{ KIND_LABELS[row.hit.kind] }}</span>
            <span class="note-line__text">{{ row.hit.excerpt }}</span>
          </p>
        </div>
      </div>

      <template #detail>
        <!-- id が変わったら作り直す。前のタスクの編集状態を持ち越さないため -->
        <ItemDetail
          v-if="selectedId"
          :key="selectedId"
          ref="detail"
          :item-id="selectedId"
          embedded
          @changed="refresh()"
        />
        <!--
          日記は読むだけで出す。ここで書けるようにはしない（書く場所は
          日記のページ）。探しているあいだに中身を確かめられれば足りる。
        -->
        <DiaryPreview
          v-else-if="selectedDiaryDate"
          :key="selectedDiaryDate"
          :date="selectedDiaryDate"
        />
      </template>
    </ListDetailSplit>
  </div>

  <!--
    タスクへの操作（ショートカット・ダイアログ・操作シート・選択中の帯）。
    一覧と同じものを使う（app/components/ItemActions.vue）。
  -->
  <ItemActions
    ref="actions"
    :list="list"
    :completed="view === 'completed'"
    switchable
    :open="openItem"
    :focus-detail="focusDetail"
    @update:completed="
      (value) => setQuery({ completed: value ? 'true' : undefined })
    "
  />
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

/*
 * 結果は一覧と同じ密度で並べる。1件ずつ浮かせず、罫線だけで区切る
 * （ItemCard がその形なので、間を空けるとカードだけが浮いて見える）。
 */
.results {
  min-width: 0;
}

/* 下端に浮かせた操作の帯（SelectionBar）のぶん、最後のカードの下を空ける */
.results--selecting {
  padding-bottom: 4rem;
}

/*
 * 抜粋を添える行（作業記録で当たったもの）は、カードとの間の罫線を消して
 * ひと続きに見せる。区切られていると、下の1行が次の結果に見えてしまう。
 */
.row--noted :deep(.card) {
  border-bottom: 0;
}

/*
 * 日記の行。カードと同じ高さ・同じ罫線で並べるが、左端の帯・チェック・
 * 期限は出さない（どれも Item に付くもので、日記は持たない）。
 */
.diary-hit {
  display: flex;
  align-items: baseline;
  gap: 0.5rem;
  min-width: 0;
  padding: 0.375rem 0.75rem 0.375rem 0.5rem;
  background: var(--surface);
  border-bottom: 1px solid var(--border);
  color: inherit;
  text-decoration: none;
  font-size: 0.9375rem;
}

/* カーソル位置。一覧のカードと同じ塗りで示す */
.diary-hit--focused {
  background: var(--cursor-bg);
}

.diary-hit__date {
  flex: 0 0 auto;
  color: var(--text-muted);
  font-size: 0.75rem;
  font-variant-numeric: tabular-nums;
}

.diary-hit__kind {
  flex: 0 0 auto;
  border: 1px solid var(--border);
  border-radius: 999px;
  padding: 0 0.375rem;
  color: var(--text-muted);
  font-size: 0.75rem;
}

.diary-hit__excerpt {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--text-muted);
  font-size: 0.875rem;
}

/*
 * 作業記録で当たった行に添える1行。カードの下に、字下げして小さく置く。
 * どこに書いてあって当たったのかは、カードだけでは分からないため。
 */
.note-line {
  display: flex;
  align-items: baseline;
  gap: 0.5rem;
  margin: 0;
  min-width: 0;
  padding: 0 0.75rem 0.375rem 2.125rem;
  background: var(--surface);
  border-bottom: 1px solid var(--border);
  color: var(--text-muted);
  font-size: 0.8125rem;
}

.note-line__date {
  flex: 0 0 auto;
  font-size: 0.75rem;
  font-variant-numeric: tabular-nums;
}

.note-line__kind {
  flex: 0 0 auto;
  border: 1px solid var(--border);
  border-radius: 999px;
  padding: 0 0.375rem;
  font-size: 0.75rem;
}

.note-line__text {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
