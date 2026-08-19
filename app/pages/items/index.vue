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

/**
 * 完了だけを見ている状態（`h`）。一覧コンポーネント側が URL に置く。
 *
 * タブの見た目はこちらを優先する。完了を見ている間に「未着手」が
 * 選ばれたままだと、一覧と選択中のタブが食い違って見えるため。
 */
const completed = computed(() => route.query.completed === 'true')

const activeTab = computed<ItemStatus | 'all'>(() =>
  completed.value ? 'closed' : status.value,
)

const listView = ref<{ create: (text: string) => Promise<boolean> } | null>(null)

useHead({ title: 'タスク' })

/** status を切り替える。タグの絞り込みは一覧コンポーネント側が持つ。 */
function selectStatus(value: ItemStatus | 'all') {
  const query: Record<string, unknown> = { ...route.query, status: value }
  // 一覧の中身が変わるので、選択は持ち越さない
  delete query.selected
  // タブを選んだらそれが指す status に従う。完了の表示は解く
  delete query.completed
  router.replace({ query: query as Record<string, string> })
}

async function add(text: string) {
  await listView.value?.create(text)
}
</script>

<template>
  <div class="page">
    <header class="head">
      <h1 class="head__title">タスク</h1>
      <!-- list__bar（未完了/完了・並び・ヘルプ）をここへテレポートする。
           一覧側の別行にすると、その分だけ表示エリアが押し下がるため -->
      <div id="items-list-bar" class="head__bar" />
    </header>

    <nav class="tabs" aria-label="status">
      <button
        v-for="item in TABS"
        :key="item.value"
        type="button"
        class="tabs__item"
        :class="{ 'tabs__item--active': activeTab === item.value }"
        :aria-current="activeTab === item.value ? 'page' : undefined"
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
      :show-tag-filter="false"
      bar-target="#items-list-bar"
      empty-message="該当するタスクはありません。"
    />
  </div>
</template>

<style scoped>
.page {
  display: grid;
  gap: 1rem;
}

.head {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 0.625rem;
}

.head__title {
  margin: 0;
  font-size: 1.25rem;
  font-weight: 700;
}

.head__bar {
  /* list__bar（未完了/完了・並び・ヘルプ）がテレポートされてくる場所。
     残りの幅をここへ持たせ、タイトルの右側に並べる */
  flex: 1 1 auto;
  min-width: 0;
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
