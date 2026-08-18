<script setup lang="ts">
import { STATUS_LABELS, isItemStatus, type ItemStatus } from '~~/shared/types/item'
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

const listView = ref<{ create: (text: string) => Promise<boolean> } | null>(null)

useHead({ title: 'タスク' })

function setQuery(patch: Record<string, string | undefined>) {
  // 絞り込みが変わったら選択を解除する。
  // 前の絞り込みで選んでいたタスクが、新しい一覧に無いまま残るのを避ける。
  const clearSelected = ['status', 'tag', 'untagged'].some((key) => key in patch)
  const query = { ...route.query, ...patch }
  if (clearSelected) delete query.selected
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
    />
  </div>
</template>

<style scoped>
.page {
  display: grid;
  gap: 1rem;
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
