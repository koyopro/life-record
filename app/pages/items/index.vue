<script setup lang="ts">
import { STATUS_LABELS, isItemStatus, type ItemStatus } from '~~/shared/types/item'

// 一覧の右側に詳細を並べるため、この画面だけコンテナを広く使う
definePageMeta({ wide: true })

const route = useRoute()
const router = useRouter()
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

const listView = ref<{ create: (text: string) => Promise<boolean> } | null>(null)

useHead({ title: 'タスク' })

/** status を切り替える。タグの絞り込みは一覧コンポーネント側が持つ。 */
function selectStatus(value: ItemStatus | 'all') {
  const query: Record<string, unknown> = { ...route.query, status: value }
  // 一覧の中身が変わるので、選択は持ち越さない
  delete query.selected
  router.replace({ query: query as Record<string, string> })
}

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
        @click="selectStatus(item.value)"
      >
        {{ item.label }}
      </button>
    </nav>

    <ItemComposer
      :multiline="false"
      placeholder="タスクを追加（例: 請求書を出す ^明日 !1 #仕事）"
      @submit="add"
    />

    <ItemListView
      :key="status"
      ref="listView"
      :status="status"
      storage-key="sort:items"
      show-sort
      empty-message="該当するタスクはありません。"
    />
  </div>
</template>

<style scoped>
.page {
  display: grid;
  gap: 1rem;
}

.tabs {
  display: flex;
  gap: 0.25rem;
  overflow-x: auto;
  /* 横スクロールはしてよいが、スクロールバーは出さない */
  scrollbar-width: none;
}

.tabs::-webkit-scrollbar {
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

</style>
