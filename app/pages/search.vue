<script setup lang="ts">
import {
  ITEM_STATUSES,
  STATUS_LABELS,
  isItemStatus,
  type ItemStatus,
} from '~~/shared/types/item'
import {
  SEARCH_KINDS,
  SEARCH_KIND_LABELS,
  isSearchKind,
  type SearchHit,
  type SearchKind,
} from '~~/shared/types/search'
import { formatAppDate, isAppDate } from '~~/shared/utils/date'

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
const status = computed<ItemStatus | 'all'>(() => {
  const value = route.query.status
  return isItemStatus(value) ? value : 'all'
})
const from = computed(() =>
  isAppDate(route.query.from) ? String(route.query.from) : '',
)
const to = computed(() => (isAppDate(route.query.to) ? String(route.query.to) : ''))

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
const statusParam = computed(() =>
  status.value === 'all' ? undefined : status.value,
)

const { data: hits, pending } = await useFetch<SearchHit[]>('/api/search', {
  query: { q: term, kind, status: statusParam, from, to },
  default: () => [],
})

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
        <label class="filters__field">
          <span class="filters__label">状態</span>
          <select
            class="filters__select"
            :value="status"
            @change="setQuery({
              status: (($event.target as HTMLSelectElement).value === 'all')
                ? undefined
                : ($event.target as HTMLSelectElement).value,
            })"
          >
            <option value="all">すべて</option>
            <option v-for="value in ITEM_STATUSES" :key="value" :value="value">
              {{ STATUS_LABELS[value] }}
            </option>
          </select>
        </label>

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
    </div>

    <p v-if="status !== 'all' && kind === 'all'" class="note">
      状態で絞っているため、日記は結果に含めていません。
    </p>

    <p v-if="!hasQuery" class="page__placeholder">
      探したい言葉を入れてください。
    </p>
    <p v-else-if="pending && !hits.length" class="page__placeholder">読み込み中…</p>
    <p v-else-if="!hits.length" class="page__placeholder">見つかりませんでした。</p>

    <ul v-else class="results">
      <li v-for="hit in hits" :key="hit.id">
        <NuxtLink class="hit" :to="hit.path">
          <div class="hit__head">
            <time class="hit__date" :datetime="hit.date">
              {{ formatAppDate(hit.date) }}
            </time>
            <span class="hit__kind">{{ KIND_LABELS[hit.kind] }}</span>
            <span v-if="hit.status" class="hit__status">
              {{ STATUS_LABELS[hit.status] }}
            </span>
          </div>
          <p class="hit__title">{{ hit.title }}</p>
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
  display: grid;
  gap: 0.1875rem;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 0.75rem;
  color: inherit;
  text-decoration: none;
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

.hit__title {
  margin: 0;
  font-size: 0.9375rem;
  font-weight: 600;
}

.hit__excerpt {
  margin: 0;
  color: var(--text-muted);
  font-size: 0.875rem;
  line-height: 1.6;
}
</style>
