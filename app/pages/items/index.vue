<script setup lang="ts">
import {
  STATUS_LABELS,
  isItemStatus,
  type ItemDto,
  type ItemStatus,
} from '~~/shared/types/item'
import { normalizeTagName } from '~~/shared/types/tag'

// 一覧の右側に詳細を並べるため、この画面だけコンテナを広く使う
definePageMeta({ wide: true })

const route = useRoute()
const router = useRouter()
const { tags } = useTags()

const TABS: { value: ItemStatus | 'all'; label: string }[] = [
  { value: 'backlog', label: STATUS_LABELS.backlog },
  { value: 'in_progress', label: STATUS_LABELS.in_progress },
  { value: 'closed', label: STATUS_LABELS.closed },
  { value: 'all', label: 'すべて' },
]

const status = computed<ItemStatus | 'all'>(() => {
  const value = route.query.status
  if (value === 'all' || isItemStatus(value)) return value
  return 'backlog'
})

const tag = computed<string | undefined>(() => {
  const value = route.query.tag
  if (typeof value !== 'string') return undefined
  return normalizeTagName(value) ?? undefined
})

const untagged = computed(() => route.query.untagged === 'true')

interface ListViewExposed {
  create: (text: string) => Promise<boolean>
  refresh: () => Promise<void>
  focusItem: (id: string) => void
}

const listView = ref<ListViewExposed | null>(null)

useHead({ title: 'タスク' })

// --- 分割表示 -----------------------------------------------------------
//
// 画面が広ければ、一覧を左に残したまま右側に詳細を出す。
// 狭い画面では従来どおり詳細画面へ遷移する。

const split = useSplitLayout()

/**
 * カーソルが指している Item。
 *
 * 画面幅にかかわらず持っておく。`split` はマウント後に確定するため、
 * ここで幅を判定すると初回の選択を取りこぼす。
 */
const cursorId = ref<string | null>(null)

/** 系列リンクなど、カーソル以外から明示的に選んだもの。 */
const pinnedId = ref<string | null>(
  typeof route.query.selected === 'string' ? route.query.selected : null,
)

const selectedId = computed(() =>
  split.value ? (pinnedId.value ?? cursorId.value) : null,
)

function onSelect(item: ItemDto | null) {
  const previous = cursorId.value
  cursorId.value = item?.id ?? null

  // カーソルが実際に動いたときだけ、明示的な選択を解除する。
  // 再取得のたびに解除すると、編集の直後に別のタスクへ飛んでしまう。
  if (previous && item && previous !== item.id) {
    pinnedId.value = null
  }
}

function onOpen(item: ItemDto) {
  if (split.value) {
    pinnedId.value = item.id
    return
  }
  navigateTo(`/items/${item.id}`)
}

// 選択を URL に残す。再読み込みや共有で同じ状態に戻せるようにする。
// 履歴を汚さないよう replace を使う。
watch(selectedId, (id) => {
  const next = id ?? undefined
  if (route.query.selected === next) return
  setQuery({ selected: next })
})

function onRemoved(id: string) {
  if (pinnedId.value === id) pinnedId.value = null
  void listView.value?.refresh()
}

function onChanged() {
  void listView.value?.refresh()
}

/** 右ペインで系列の別オカレンスを選んだとき。一覧にあればカーソルも合わせる。 */
function onSelectSeries(id: string) {
  pinnedId.value = id
  listView.value?.focusItem(id)
}

function setQuery(patch: Record<string, string | undefined>) {
  const query = { ...route.query, ...patch }
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined) delete query[key]
  }
  router.replace({ query })
}

function selectTag(name: string) {
  // 同じタグをもう一度押したら解除する
  setQuery({
    tag: tag.value === name ? undefined : name,
    untagged: undefined,
  })
}

function toggleUntagged() {
  setQuery({
    untagged: untagged.value ? undefined : 'true',
    tag: undefined,
  })
}

/**
 * 一覧の状態を作り直す条件。
 * 絞り込みが変わったらカーソルや選択を持ち越さない。
 */
const listKey = computed(
  () => `${status.value}:${tag.value ?? ''}:${untagged.value}`,
)

async function add(text: string) {
  await listView.value?.create(text)
}
</script>

<template>
  <div class="page">
    <nav class="tabs" aria-label="status">
      <button
        v-for="item in TABS"
        :key="item.value"
        type="button"
        class="tabs__item"
        :class="{ 'tabs__item--active': status === item.value }"
        :aria-current="status === item.value ? 'page' : undefined"
        @click="setQuery({ status: item.value })"
      >
        {{ item.label }}
      </button>
    </nav>

    <nav v-if="tags.length" class="tags" aria-label="タグ">
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
        v-for="item in tags"
        :key="item.id"
        type="button"
        class="tags__item"
        :class="{ 'tags__item--active': tag === item.name }"
        :aria-pressed="tag === item.name"
        @click="selectTag(item.name)"
      >
        #{{ item.name }}
        <span class="tags__count">{{ item.count }}</span>
      </button>
    </nav>

    <ItemComposer
      :multiline="false"
      placeholder="タスクを追加（例: 請求書を出す ^明日 !1 #仕事）"
      @submit="add"
    />

    <div class="split" :class="{ 'split--active': split && selectedId }">
      <div class="split__list">
        <ItemListView
          :key="listKey"
          ref="listView"
          :status="status"
          :tag="tag"
          :untagged="untagged"
          storage-key="sort:items"
          show-sort
          :empty-message="
            tag || untagged
              ? 'この絞り込みに該当するタスクはありません。'
              : '該当するタスクはありません。'
          "
          @filter-tag="selectTag"
          @select="onSelect"
          @open="onOpen"
        />
      </div>

      <aside v-if="split && selectedId" class="split__detail">
        <!-- id が変わったら作り直す。前のタスクの編集状態を持ち越さないため -->
        <ItemDetail
          :key="selectedId"
          :item-id="selectedId"
          embedded
          @removed="onRemoved"
          @changed="onChanged"
          @select-series="onSelectSeries"
        />
      </aside>
    </div>
  </div>
</template>

<style scoped>
.page {
  display: grid;
  gap: 1rem;
}

.split {
  display: grid;
  gap: 1.5rem;
}

/* 一覧と詳細を並べる。詳細側はスクロールを分けて、
   長い本文を読んでも一覧の位置が動かないようにする。 */
@media (min-width: 60rem) {
  .split--active {
    grid-template-columns: minmax(0, 22rem) minmax(0, 1fr);
    align-items: start;
  }

  .split--active .split__detail {
    position: sticky;
    top: 1rem;
    max-height: calc(100vh - 2rem);
    overflow-y: auto;
    padding-right: 0.25rem;
  }
}

.split__list {
  min-width: 0;
}

.split__detail {
  min-width: 0;
  border-left: 1px solid var(--border);
  padding-left: 1.5rem;
}

.tabs,
.tags {
  display: flex;
  gap: 0.25rem;
  overflow-x: auto;
  /* 横スクロールはしてよいが、スクロールバーは出さない */
  scrollbar-width: none;
}

.tabs::-webkit-scrollbar,
.tags::-webkit-scrollbar {
  display: none;
}

.tabs__item {
  background: transparent;
  border: 1px solid var(--border);
  border-radius: 999px;
  color: var(--text-muted);
  min-height: 2.25rem;
  padding: 0 0.875rem;
  white-space: nowrap;
  font-size: 0.875rem;
}

.tabs__item--active {
  background: var(--accent);
  border-color: var(--accent);
  color: var(--accent-text);
  font-weight: 600;
}

.tags {
  margin-top: -0.5rem;
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
</style>
