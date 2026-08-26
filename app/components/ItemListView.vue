<script setup lang="ts">
import type { Shortcut } from '~/composables/useShortcuts'
import {
  GROUP_KEYS,
  GROUP_LABELS,
  SORT_KEYS,
  SORT_LABELS,
  type GroupKey,
  type ItemDto,
  type ItemStatus,
  type SortKey,
} from '~~/shared/types/item'
import type { ListView } from '~~/shared/types/smart-list'
import { groupItems } from '~/utils/item-order'
import { normalizeTagName } from '~~/shared/types/tag'

const props = withDefaults(
  defineProps<{
    status: ItemStatus | 'all'
    /**
     * どの一覧か（`items` / `today`）。並び・グループ順を覚える鍵に使う。
     * スマートリストのように覚え先が別にあるときは渡さない。
     */
    screen?: string
    /**
     * 表示方法を固定する（スマートリスト）。渡すと「未完了 / 完了」の
     * 切り替えは出さず、`all` なら状態を見ない見え方になる。
     */
    view?: ListView
    /** 絞り込むタグを固定する（スマートリスト）。URL のタグより優先する。 */
    fixedTag?: string | null
    /** 並び・グループ順を外から与える（スマートリスト）。 */
    sort?: SortKey
    group?: GroupKey
    /** 並べ替えを操作させるか。 */
    showSort?: boolean
    /** タグの絞り込みバーを出すか。 */
    showTagFilter?: boolean
    /**
     * 指定すると、未完了/完了・並び・ヘルプボタンの行（list__bar）を
     * ここへ描画する（テレポート）。呼び出し側の header に含め、
     * 一覧の表示エリアを押し下げないようにするため。
     * CSS セレクタで渡す（SSR でも解決できるように）。
     */
    barTarget?: string
    /** 期限が今日までのものだけに絞るか（「今日」リスト）。 */
    dueUntilToday?: boolean
    /** 既定のソート軸。 */
    defaultSort?: SortKey
    emptyMessage: string
  }>(),
  { showTagFilter: true },
)

const emit = defineEmits<{
  /** 並び・グループ順を選び直した（外から与えているときだけ出す）。 */
  'update:sort': [value: SortKey]
  'update:group': [value: GroupKey]
}>()

const route = useRoute()
const router = useRouter()

// --- タグでの絞り込み（docs/09-tags.md 9.3） -----------------------------
//
// どの一覧でも同じように使えるよう、ここで持つ。
// 状態は URL に置き、再読み込みや共有で同じ絞り込みに戻せるようにする。

const { tags: allTags } = useTags()

const tag = computed<string | undefined>(() => {
  if (props.fixedTag !== undefined) return props.fixedTag ?? undefined
  const value = route.query.tag
  if (typeof value !== 'string') return undefined
  return normalizeTagName(value) ?? undefined
})

const untagged = computed(() => route.query.untagged === 'true')

// --- 完了済みの表示（`h`） -----------------------------------------------
//
// RTM の「未完了 / 完了」の切り替えと同じ。いまの絞り込み（タグ・期限）は
// そのままに、完了したものだけを出す。状態は URL に残す。
//
// 両側とも useItemList があらかじめ取っておくので、切り替えは待たされない。

const view = computed<ListView>(
  () => props.view ?? (route.query.completed === 'true' ? 'completed' : 'open'),
)

/** 完了側を見ているか。操作の向き（完了にする / 戻す）を決めるのに使う。 */
const completed = computed(() => view.value === 'completed')

/** 「未完了 / 完了」を切り替えられるか。固定されていれば切り替えない。 */
const switchable = computed(() => props.view === undefined)

const list = useItemList({
  status: () => props.status,
  view: () => view.value,
  tag: () => tag.value,
  untagged: () => untagged.value,
  dueUntilToday: () => Boolean(props.dueUntilToday),
  screen: props.screen,
  defaultSort: props.defaultSort ?? 'priorityDueDesc',
  sort: props.sort === undefined ? undefined : () => props.sort!,
  groupBy: props.group === undefined ? undefined : () => props.group!,
  onSortChange: (value) => emit('update:sort', value),
  onGroupChange: (value) => emit('update:group', value),
})

/**
 * グループ順（並びより上位の区切り、RTM の Group by）。並び替え済みの
 * `list.items` を、選んでいる軸で見出し付きの塊に分けるだけで、
 * 各グループの中の順序は並びのまま変えない。
 */
const groupedItems = computed(() => groupItems(list.items.value, list.groupBy.value))

// --- 分割表示（docs/03-functional-spec.md 3.1） ---------------------------
//
// 画面が広ければ、一覧を左に残したまま右側に詳細を出す。
// すべての一覧で同じ挙動にしたいので、ここに置いて共通化する。

const split = useSplitLayout()

/*
 * 画面の左端からのスワイプで左袖を引き出す（app/composables/useSidebarSwipe.ts）。
 *
 * 一覧を出している画面だけに付ける。狭い画面では袖を開く入口が左下の ☰
 * しかなく、一覧 → 別の一覧の移動のたびに親指を下ろすことになるため。
 */
useSidebarSwipe()

/*
 * カーソルの行を画面内へ送るための入れ物（`useListCursor`）。
 * 各行の `data-item-id` から引くので、テンプレートで結ぶだけでよい。
 */
const listEl = list.listEl

/**
 * カーソル以外から明示的に選んだ Item。
 *
 * 系列の過去オカレンスなど、いま表示している一覧に含まれないものを
 * 出す場合があるため、カーソルとは別に持つ。
 */
const pinnedId = ref<string | null>(
  typeof route.query.selected === 'string' ? route.query.selected : null,
)

const selectedId = computed(() =>
  split.value ? (pinnedId.value ?? list.cursorItem.value?.id ?? null) : null,
)

// カーソルが実際に動いたら、明示的な選択は解除してカーソルに追従させる。
// 再取得のたびに解除すると、編集の直後に別のタスクへ飛んでしまう。
watch(
  () => list.cursorItem.value?.id,
  (id, previous) => {
    if (id && previous && id !== previous) pinnedId.value = null
  },
)

// 選択を URL に残す。再読み込みや共有で同じ状態に戻せるようにする。
// 履歴を汚さないよう replace を使う。
watch(selectedId, (id) => {
  const next = id ?? undefined
  if (route.query.selected === next) return
  const query = { ...route.query, selected: next }
  if (!next) delete query.selected
  router.replace({ query })
})

/**
 * 詳細を開く。広い画面では右ペインに出し、狭い画面では詳細画面へ遷移する。
 *
 * カーソルも合わせる。合わせないと、右ペインに出したものと
 * キーボード操作の対象がずれる。
 */
function open(item: ItemDto) {
  list.focusItem(item.id)
  if (split.value) {
    pinnedId.value = item.id
    return
  }
  navigateTo(`/items/${item.id}`)
}

interface DetailExposed {
  focusTitle: () => void
  focusUrl: () => void | Promise<void>
  focusBody: () => void
}

/** どの欄へ移りたいかを、詳細画面へ URL で渡すときの名前。 */
const FOCUS_QUERY = {
  Title: 'title',
  Url: 'url',
  Body: 'body',
} as const

const detail = ref<DetailExposed | null>(null)

/**
 * 詳細の指定した欄へフォーカスする（`r` / `u` / `y`）。
 *
 * 右ペインが出ていればその欄へ。出ていない狭い画面では、
 * 編集できる場所が詳細画面しかないのでそちらへ移動する。
 * 移動しただけでは欄に入れないので、どこへ入りたかったかを URL で渡す。
 */
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

/**
 * チェックの四角を押した（マウス・指）。
 *
 * チェックと合わせて**カーソルもその行へ動かす**。押した行が色付きにならないと、
 * 続けて押すキー操作（`c` / `d` など）がどこを起点にしているのか読み取れない。
 * `i`（キーボードでの選択）はもともとカーソルの行が対象なので、これで
 * どちらから選んでも「押した行＝カーソル」でそろう。
 *
 * 外すときも同じく動かす。カーソルは「いまどこにいるか」を示すだけなので、
 * 触れた行に付いてくるほうが分かりやすい。
 */
function selectItem(item: ItemDto) {
  list.focusItem(item.id)
  list.toggleSelect(item.id)
}

function onDetailRemoved(id: string) {
  if (pinnedId.value === id) pinnedId.value = null
  // 詳細側の削除も裏で送られる。取り直しはその後ろに並べる
  void enqueue(() => list.refresh())
}

/** 右ペインで系列の別オカレンスを選んだとき。一覧にあればカーソルも合わせる。 */
function onSelectSeries(id: string) {
  pinnedId.value = id
  list.focusItem(id)
}

function setFilter(patch: { tag?: string; untagged?: string; completed?: string }) {
  const query: Record<string, unknown> = { ...route.query, ...patch }
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined) delete query[key]
  }
  // 絞り込みが変われば一覧の中身も変わるので、選択は持ち越さない
  delete query.selected
  pinnedId.value = null
  router.replace({ query: query as Record<string, string> })
}

/** 同じタグをもう一度押したら解除する。 */
function selectTag(name: string) {
  setFilter({
    tag: tag.value === name ? undefined : name,
    untagged: undefined,
  })
}

function toggleUntagged() {
  setFilter({
    untagged: untagged.value ? undefined : 'true',
    tag: undefined,
  })
}

/** 未完了 / 完了 を切り替える（`h`）。固定されているリストでは何もしない。 */
function showCompleted(value: boolean) {
  if (!switchable.value || value === completed.value) return
  setFilter({ completed: value ? 'true' : undefined })
}

/**
 * 一覧の中を移動するショートカット（docs/08-todo-management.md 8.4）。
 *
 * 編集・選択・削除は `ItemActions` が持つ（検索結果と共通）。ここに残すのは
 * 「何を1本の並びとして送るか」を知っていないと書けないものだけ。
 */
const shortcuts = computed<Shortcut[]>(() => [
  {
    keys: ['j', 'ArrowDown'],
    display: 'j / ↓',
    label: '次のタスクへ',
    group: '移動',
    run: () => list.moveCursor(1),
  },
  {
    keys: ['k', 'ArrowUp'],
    display: 'k / ↑',
    label: '前のタスクへ',
    group: '移動',
    run: () => list.moveCursor(-1),
  },
  {
    keys: ['o', 'Enter'],
    display: 'o',
    label: 'タスクを開く',
    group: '移動',
    run: () => {
      const target = list.cursorItem.value
      if (target) open(target)
    },
  },
  {
    /*
     * 検索へ移る。app.vue には置かない。ページは非同期に読み込まれるので
     * app.vue の登録のほうが先になり、検索画面自身の `/`（検索語を打ち直す）
     * を追い越してしまう。
     */
    keys: ['/'],
    label: '検索',
    group: 'その他',
    run: () => void navigateTo('/search'),
  },
])

useShortcuts(shortcuts)

/*
 * 操作（完了・期限・タグ・削除…）は ItemActions が持つ（検索結果と共通）。
 * カードのスワイプと長押しだけはカードから届くので、そちらへ渡す。
 */
const actions = ref<{
  toggleComplete: (item: ItemDto) => void
  openSheet: (item: ItemDto) => void
  showHelp: () => void
} | null>(null)

defineExpose({
  create: list.create,
  refresh: list.refresh,
  focusItem: list.focusItem,
})
</script>

<template>
  <!-- 一覧と詳細の並べ方は ListDetailSplit が持つ（検索結果と共通） -->
  <ListDetailSplit :active="Boolean(selectedId)">
    <!-- 選択中は下端に帯が出るので、最後のカードが隠れないよう空ける -->
    <div class="list" :class="{ 'list--selecting': list.selectedIds.value.size }">
      <nav v-if="showTagFilter && allTags.length" class="tags" aria-label="タグで絞り込む">
        <button
          type="button"
          class="tags__item"
          :class="{ 'tags__item--active': untagged }"
          :aria-pressed="untagged"
          @click="toggleUntagged"
        >
          タグなし
        </button>
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
          <span class="tags__count">{{ entry.count }}</span>
        </button>
      </nav>

      <Teleport :disabled="!barTarget" :to="barTarget || 'body'">
        <div class="list__bar">
          <!-- キーボードを使わなくても切り替えられるようにする（`h` と同じ） -->
          <div v-if="switchable" class="list__view" role="group" aria-label="完了 / 未完了">
            <button
              type="button"
              class="list__view-item"
              :class="{ 'list__view-item--active': !completed }"
              :aria-pressed="!completed"
              @click="showCompleted(false)"
            >
              未完了
            </button>
            <button
              type="button"
              class="list__view-item"
              :class="{ 'list__view-item--active': completed }"
              :aria-pressed="completed"
              @click="showCompleted(true)"
            >
              完了
            </button>
          </div>

          <!--
            知らせは選択中の件数と並べて出す。まとめて操作したときこそ
            結果（「3件をコピーした」）を見せたいので、件数で隠さない。
          -->
          <div class="list__status" role="status">
            <span v-if="list.selectedIds.value.size" class="list__selected">
              {{ list.selectedIds.value.size }}件を選択中
            </span>
            <span v-if="list.message.value" class="list__message">
              {{ list.message.value }}
            </span>
          </div>

          <div class="list__controls">
            <label v-if="showSort" class="list__sort">
              <span class="list__sort-label">グループ</span>
              <select v-model="list.groupBy.value" class="list__sort-select">
                <option v-for="key in GROUP_KEYS" :key="key" :value="key">
                  {{ GROUP_LABELS[key] }}
                </option>
              </select>
            </label>
            <label v-if="showSort" class="list__sort">
              <span class="list__sort-label">並び</span>
              <select v-model="list.sort.value" class="list__sort-select">
                <option v-for="key in SORT_KEYS" :key="key" :value="key">
                  {{ SORT_LABELS[key] }}
                </option>
              </select>
            </label>
            <button
              type="button"
              class="list__help"
              aria-label="キーボードショートカット"
              @click="actions?.showHelp()"
            >
              ?
            </button>
          </div>
        </div>
      </Teleport>

      <p v-if="list.errorMessage.value" class="list__error" role="alert">
        {{ list.errorMessage.value }}
      </p>
      <p v-if="list.error.value" class="list__error" role="alert">
        一覧を読み込めませんでした
      </p>

      <p
        v-else-if="list.loading.value && !list.items.value.length"
        class="list__placeholder"
      >
        読み込み中…
      </p>

      <p v-else-if="!list.items.value.length" class="list__placeholder">
        {{ completed ? '完了したタスクはありません。' : emptyMessage }}
      </p>

      <div v-else ref="listEl" class="list__groups">
        <section v-for="group in groupedItems" :key="group.key" class="list__group">
          <h2 v-if="group.label" class="list__group-title">{{ group.label }}</h2>
          <ul class="list__items">
            <li
              v-for="{ item, index } in group.items"
              :key="item.id"
              :data-item-id="item.id"
            >
              <ItemCard
                :item="item"
                :focused="index === list.cursor.value"
                :selected="list.selectedIds.value.has(item.id)"
                :pending="item.syncState !== 'synced'"
                :ignore-status="view === 'all'"
                @focus="list.focusItem(item.id)"
                @select="selectItem(item)"
                @complete="actions?.toggleComplete(item)"
                @open="open(item)"
                @longpress="actions?.openSheet(item)"
                @filter-tag="selectTag"
              />
            </li>
          </ul>
        </section>
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
        @removed="onDetailRemoved"
        @changed="list.refresh()"
        @select-series="onSelectSeries"
      />
    </template>
  </ListDetailSplit>

  <!--
    タスクへの操作（ショートカット・ダイアログ・操作シート・選択中の帯）。
    検索結果と同じものを使う（app/components/ItemActions.vue）。
  -->
  <ItemActions
    ref="actions"
    :list="list"
    :completed="completed"
    :switchable="switchable"
    :open="open"
    :focus-detail="focusDetail"
    @update:completed="showCompleted"
  />
</template>

<style scoped>
.list {
  min-width: 0;
  /* 列は親の幅に収める（はみ出させず、中身のほうを折り返させる） */
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 0.625rem;
}

/* 下端に浮かせた操作の帯（SelectionBar）のぶん、最後のカードの下を空ける */
.list--selecting {
  padding-bottom: 4rem;
}

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
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
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

.tags__count {
  font-size: 0.6875rem;
  font-variant-numeric: tabular-nums;
  opacity: 0.7;
}

.list__bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  /* 一覧が狭いとき（分割表示の左側）は、操作を次の行へ送る */
  flex-wrap: wrap;
  gap: 0.5rem 0.75rem;
  min-width: 0;
  min-height: 2rem;
}

.list__status {
  color: var(--text-muted);
  font-size: 0.8125rem;
  /* 左の切り替えと右の並び替えのあいだを埋める */
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.list__selected {
  color: var(--accent);
  font-weight: 600;
}

/* 件数と並べたときの区切り。単独で出ているときは付けない */
.list__selected + .list__message::before {
  content: '・';
}

.list__controls {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 0.5rem;
  min-width: 0;
}

/* 未完了 / 完了。いま何を見ているかが一目で分かるよう、両方を出す */
.list__view {
  display: flex;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 8px;
  overflow: hidden;
}

.list__view-item {
  background: transparent;
  border: 0;
  color: var(--text-muted);
  min-height: 2.25rem;
  padding: 0 0.625rem;
  font-size: 0.8125rem;
  white-space: nowrap;
}

.list__view-item--active {
  background: color-mix(in srgb, var(--accent) 14%, transparent);
  color: var(--accent);
  font-weight: 600;
}

.list__sort {
  display: flex;
  align-items: center;
  gap: 0.375rem;
  min-width: 0;
}

.list__sort-label {
  color: var(--text-muted);
  font-size: 0.8125rem;
}

.list__sort-select {
  font: inherit;
  font-size: 0.875rem;
  /* 選択肢の文字数ぶんの幅を要求させない。狭いときは縮める */
  min-width: 0;
  max-width: 100%;
  background: var(--surface);
  color: var(--text);
  border: 1px solid var(--border);
  border-radius: 8px;
  min-height: 2.25rem;
  padding: 0 0.5rem;
}

.list__help {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 8px;
  color: var(--text-muted);
  width: 2.25rem;
  height: 2.25rem;
}

/* キーボードが使えない端末ではヘルプを出す意味が薄い */
@media (hover: none) {
  .list__help {
    display: none;
  }
}

/*
 * グループ順（RTM の Group by）。見出しが無い（グループ順「なし」）ときは
 * 1つの塊だけになるので、これまでの単一の一覧と見た目が変わらないように、
 * 余白は見出しの有無に関わらず .list__group 側にまとめる。
 */
.list__groups {
  display: grid;
  gap: 1rem;
}

.list__group-title {
  margin: 0 0 0.375rem;
  font-size: 0.875rem;
  font-weight: 600;
  color: var(--text-muted);
}

/*
 * 行の間は空けず、罫線だけで区切る（RTM に倣う）。1画面に入る件数を
 * 増やすため。行どうしの区切りは各行の下線（ItemCard.vue の .card）が
 * 引くので、ここでは一覧の上端だけ閉じる。
 */
.list__items {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  border-top: 1px solid var(--border);
  /* スワイプ時にカードが横へずれても見切れないようにする */
  overflow-x: clip;
}

.list__placeholder {
  margin: 0;
  color: var(--text-muted);
  text-align: center;
  padding: 2rem 0;
}

.list__error {
  margin: 0;
  color: var(--danger);
  font-size: 0.875rem;
}

/*
 * 狭い画面（スマートフォン）のヘッダーは2行に収める。
 *
 *   1行目 … 画面の見出し（ページ側の .head__title）と 未完了 / 完了
 *   2行目 … グループ・並び
 *
 * 放っておくと見出し・切り替え・並び・ヘルプで4行になり、一覧が始まるまでに
 * 画面の 1/4 を使ってしまう。
 *
 * バーの入れ物（.list__bar と、テレポート先の .head__bar）を `display: contents`
 * で透明にし、**中身をページの見出しと同じ並び**（.head）へ差し出す。入れ物を
 * 残したままだと、バーは見出しの隣に置かれた1つの塊のままなので、2行目
 * （グループ・並び）が見出しのぶんだけ右へ寄ってしまう。
 *
 * 上書きの順があるので、この塊は必ず既定の指定より後ろに置く。
 */
@media (max-width: 40rem) {
  .list__bar {
    display: contents;
  }

  /* グループ・並びは次の行いっぱいに置き、見出しの左端にそろえる */
  .list__controls {
    flex: 1 0 100%;
    justify-content: flex-start;
  }

  /*
   * ヘルプ（`?`）はキーボードの割り当ての一覧。キーボードの無い画面で
   * 場所を取る意味がないので出さない（広い画面には残す）。
   */
  .list__help {
    display: none;
  }
}
</style>
