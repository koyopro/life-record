<script setup lang="ts">
import { STATUS_LABELS, isItemStatus, type ItemStatus } from '~~/shared/types/item'

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

function selectTab(value: ItemStatus | 'all') {
  router.replace({ query: { status: value } })
}

async function add(text: string) {
  await listView.value?.create(text)
}
</script>

<template>
  <div class="page">
    <nav class="tabs" aria-label="status">
      <button
        v-for="tab in TABS"
        :key="tab.value"
        type="button"
        class="tabs__item"
        :class="{ 'tabs__item--active': status === tab.value }"
        :aria-current="status === tab.value ? 'page' : undefined"
        @click="selectTab(tab.value)"
      >
        {{ tab.label }}
      </button>
    </nav>

    <ItemComposer
      :multiline="false"
      placeholder="タスクを追加（例: 請求書を出す ^明日 !1）"
      @submit="add"
    />

    <!-- status が変わったら状態を作り直す。カーソルや選択を持ち越さないため -->
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
  /* タブ自体は横スクロールしてよいが、スクロールバーは出さない */
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
