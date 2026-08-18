<script setup lang="ts">
import { SAVE_STATE_LABELS } from '~/composables/useAutosave'
import {
  ITEM_STATUSES,
  PRIORITIES,
  PRIORITY_LABELS,
  STATUS_LABELS,
  type ItemDetailDto,
  type ItemStatus,
  type Priority,
  type SectionDto,
  isOpenableUrl,
} from '~~/shared/types/item'
import type { Recurrence } from '~~/shared/types/recurrence'
import { describeRecurrence } from '~~/shared/utils/recurrence'

const props = defineProps<{
  itemId: string
  /**
   * 一覧の右側に並べて表示しているか。
   * 分割表示では「一覧へ」戻るリンクが不要になる。
   */
  embedded?: boolean
}>()

const emit = defineEmits<{
  /** 削除された。分割表示では親が選択を解除する。 */
  removed: [id: string]
  /** タイトルなどが変わった。親が一覧を取り直すために使う。 */
  changed: []
  /** 分割表示で、系列の別オカレンスを選び直した。 */
  selectSeries: [id: string]
}>()

const id = computed(() => props.itemId)

// 分割表示では itemId が切り替わるので、top-level await は使わない
// （Suspense で一覧ごと再描画されてしまうため）。
const { data: item, error, refresh } = useFetch<ItemDetailDto>(
  () => `/api/items/${id.value}`,
  { watch: [id] },
)

// --- タイトル（リアルタイム保存） --------------------------------------

/**
 * 編集中の値。まだ触っていなければ null で、取得結果をそのまま見せる。
 *
 * setup 時点の値を ref に固定してしまうと、取得が終わるのが後になる
 * サーバー描画で空のまま出力され、ハイドレーションがずれる。
 */
const titleDraft = ref<string | null>(null)
const title = computed({
  get: () => titleDraft.value ?? item.value?.title ?? '',
  set: (value: string) => {
    titleDraft.value = value
  },
})

const titleSave = useAutosave({
  source: title,
  // 空のまま保存するとサーバー側で弾かれるので、入力中は送らない
  enabled: () => title.value.trim().length > 0,
  save: async (value) => {
    await $fetch(`/api/items/${id.value}`, {
      method: 'PATCH',
      body: { title: value.trim() },
    })
    emit('changed')
  },
})

// --- 本文（リアルタイム保存） ------------------------------------------
//
// Item は本文を持たないため、本文は先頭 Section に書く
// （docs/02-data-model.md 2.9-1）。Section がなければ最初の保存時に作る。

const sections = computed<SectionDto[]>(() => item.value?.sections ?? [])
const primarySection = computed<SectionDto | null>(() => sections.value[0] ?? null)

const bodyDraft = ref<string | null>(null)
const body = computed({
  get: () => bodyDraft.value ?? primarySection.value?.body ?? '',
  set: (value: string) => {
    bodyDraft.value = value
  },
})
const bodyEditor = ref<{ focus: () => void } | null>(null)

/** 本文へフォーカスする。一覧の `y` から呼ばれる。 */
function focusBody() {
  bodyEditor.value?.focus()
}

defineExpose({ focusBody })
const createdSectionId = ref<string | null>(null)

const bodySave = useAutosave({
  source: body,
  save: async (value) => {
    const sectionId = createdSectionId.value ?? primarySection.value?.id

    if (sectionId) {
      await $fetch(`/api/sections/${sectionId}`, {
        method: 'PATCH',
        body: { body: value },
      })
      return
    }

    // まだ Section がない。空文字のまま作っても意味がないので、
    // 実際に何か書かれてから作る。
    if (!value.trim()) return

    const created = await $fetch<SectionDto>('/api/sections', {
      method: 'POST',
      body: { itemId: id.value, body: value },
    })
    createdSectionId.value = created.id
    await refresh()
  },
})

// 別画面での変更や再取得に追随する。編集中の内容は上書きしない。
watch(item, (value) => {
  if (!value) return
  if (titleSave.state.value === 'idle' || titleSave.state.value === 'saved') {
    title.value = value.title
    titleSave.markSynced()
  }
  const latest = value.sections[0]?.body ?? ''
  if (bodySave.state.value === 'idle' || bodySave.state.value === 'saved') {
    if (latest !== body.value) {
      body.value = latest
      bodySave.markSynced()
    }
  }
})

// --- URL（リアルタイム保存） -------------------------------------------

const urlDraft = ref<string | null>(null)
const url = computed({
  get: () => urlDraft.value ?? item.value?.url ?? '',
  set: (value: string) => {
    urlDraft.value = value
  },
})

const urlSave = useAutosave({
  source: url,
  // 入力途中は保存しない。書き終わって初めて http(s) の形になるため。
  enabled: () => !url.value.trim() || isOpenableUrl(url.value),
  save: async (value) => {
    await $fetch(`/api/items/${id.value}`, {
      method: 'PATCH',
      body: { url: value.trim() || null },
    })
    emit('changed')
  },
})

// --- メタデータの操作 ---------------------------------------------------

const actionError = ref<string | null>(null)

async function patch(values: Record<string, unknown>) {
  actionError.value = null
  try {
    await $fetch(`/api/items/${id.value}`, { method: 'PATCH', body: values })
    await refresh()
    emit('changed')
  } catch {
    actionError.value = '更新できませんでした'
  }
}

const dueOpen = ref(false)
const tagOpen = ref(false)
const recurrenceOpen = ref(false)
const tagList = useTags()

// --- 繰り返し ----------------------------------------------------------

const recurrence = computed<Recurrence | null>(() => {
  const value = item.value
  if (!value?.recurrenceRule || !value.recurrenceBasis) return null
  return { rule: value.recurrenceRule, basis: value.recurrenceBasis }
})

const recurrenceLabel = computed(() =>
  recurrence.value ? describeRecurrence(recurrence.value) : null,
)

async function applyRecurrence(value: Recurrence | null) {
  recurrenceOpen.value = false
  await patch({
    recurrenceRule: value?.rule ?? null,
    recurrenceBasis: value?.basis ?? null,
  })
}

/** 同じ繰り返しから生まれた過去のオカレンス。 */
const seriesId = computed(() => item.value?.seriesId ?? null)

const { data: series, refresh: refreshSeries } = useFetch<ItemDetailDto[]>(
  '/api/items',
  {
    query: { series: seriesId, sort: 'due' },
    default: () => [],
    // series が null のまま投げると絞り込みが効かず全件返ってくるので、
    // 系列が決まってから取りに行く。
    immediate: false,
  },
)

watch(
  seriesId,
  (id) => {
    if (id) void refreshSeries()
  },
  { immediate: true },
)

function occurrenceDate(entry: ItemDetailDto): string {
  return entry.dueAt
    ? new Date(entry.dueAt).toLocaleDateString('ja-JP')
    : '期限なし'
}

const pastOccurrences = computed(() => {
  const current = seriesId.value
  if (!current) return []
  return (series.value ?? [])
    // 取得内容が古い場合に備え、系列が一致するものだけに絞る
    .filter((entry) => entry.seriesId === current && entry.id !== id.value)
    .sort((a, b) => ((a.dueAt ?? '') > (b.dueAt ?? '') ? -1 : 1))
})

async function applyTags(changes: { add: string[]; remove: string[] }) {
  tagOpen.value = false
  actionError.value = null
  try {
    await $fetch('/api/items/tags', {
      method: 'POST',
      body: { ids: [id.value], add: changes.add, remove: changes.remove },
    })
    await Promise.all([refresh(), tagList.refresh()])
    emit('changed')
  } catch {
    actionError.value = 'タグを変更できませんでした'
  }
}

async function applyDue(due: { date: Date; hasTime: boolean } | null) {
  dueOpen.value = false
  await patch({
    dueAt: due?.date.toISOString() ?? null,
    dueHasTime: due?.hasTime ?? false,
  })
}

const dueLabel = computed(() =>
  item.value ? formatDue(item.value) : { label: '', state: 'none' as const },
)

async function remove() {
  if (!confirm('このタスクを削除します。よろしいですか？')) return
  await $fetch(`/api/items/${id.value}`, { method: 'DELETE' })
  emit('removed', id.value)
  if (!props.embedded) await navigateTo('/items')
}

// --- 追加の作業記録 -----------------------------------------------------

const addingSection = ref(false)

async function addSection() {
  addingSection.value = true
  try {
    await $fetch('/api/sections', {
      method: 'POST',
      body: { itemId: id.value, body: '' },
    })
    await refresh()
    emit('changed')
  } finally {
    addingSection.value = false
  }
}

async function saveSection(section: SectionDto, value: string) {
  await $fetch(`/api/sections/${section.id}`, {
    method: 'PATCH',
    body: { body: value },
  })
}

async function removeSection(section: SectionDto) {
  if (!confirm('この作業記録を削除します。よろしいですか？')) return
  await $fetch(`/api/sections/${section.id}`, { method: 'DELETE' })
  await refresh()
}
</script>

<template>
  <div class="page">
    <p v-if="error" class="page__error" role="alert">
      タスクを読み込めませんでした
    </p>

    <p v-else-if="!item" class="page__placeholder">読み込み中…</p>

    <template v-else>
      <NuxtLink v-if="!embedded" to="/items" class="page__back">← 一覧へ</NuxtLink>

      <header class="head">
        <!-- タイトルもボタンなしで保存する -->
        <textarea
          v-model="title"
          class="head__title"
          rows="1"
          aria-label="タイトル"
          @input="(e) => {
            const el = e.target as HTMLTextAreaElement
            el.style.height = 'auto'
            el.style.height = `${el.scrollHeight}px`
          }"
        />
        <span class="head__save" :class="`head__save--${titleSave.state.value}`">
          {{ SAVE_STATE_LABELS[titleSave.state.value] }}
        </span>
      </header>

      <p v-if="actionError" class="page__error" role="alert">{{ actionError }}</p>

      <section class="meta">
        <div class="meta__row">
          <span class="meta__label">状態</span>
          <div class="meta__values">
            <button
              v-for="status in ITEM_STATUSES"
              :key="status"
              type="button"
              class="chip"
              :class="{ 'chip--active': item.status === status }"
              @click="patch({ status })"
            >
              {{ STATUS_LABELS[status as ItemStatus] }}
            </button>
          </div>
        </div>

        <div class="meta__row">
          <span class="meta__label">重要度</span>
          <div class="meta__values">
            <button
              v-for="value in PRIORITIES"
              :key="value"
              type="button"
              class="chip"
              :class="{ 'chip--active': item.priority === value }"
              @click="patch({ priority: value as Priority })"
            >
              {{ PRIORITY_LABELS[value] }}
            </button>
            <button
              type="button"
              class="chip"
              :class="{ 'chip--active': item.priority === null }"
              @click="patch({ priority: null })"
            >
              なし
            </button>
          </div>
        </div>

        <div class="meta__row">
          <span class="meta__label">
            URL
            <a
              v-if="item.url && isOpenableUrl(item.url)"
              class="meta__open"
              :href="item.url"
              target="_blank"
              rel="noopener noreferrer"
            >開く</a>
            <span class="meta__save">{{ SAVE_STATE_LABELS[urlSave.state.value] }}</span>
          </span>
          <input
            v-model="url"
            class="meta__url"
            type="url"
            inputmode="url"
            placeholder="https://..."
            aria-label="URL"
          />
        </div>

        <div class="meta__row">
          <span class="meta__label">タグ</span>
          <div class="meta__values">
            <NuxtLink
              v-for="name in item.tags"
              :key="name"
              class="chip chip--link"
              :to="{ path: '/items', query: { status: 'all', tag: name } }"
            >
              #{{ name }}
            </NuxtLink>
            <button type="button" class="chip chip--quiet" @click="tagOpen = true">
              {{ item.tags.length ? '変更する' : '追加する' }}
            </button>
          </div>
        </div>

        <div class="meta__row">
          <span class="meta__label">繰り返し</span>
          <div class="meta__values">
            <button type="button" class="chip" @click="recurrenceOpen = true">
              {{ recurrenceLabel ?? '設定する' }}
            </button>
            <button
              v-if="recurrence"
              type="button"
              class="chip chip--quiet"
              @click="applyRecurrence(null)"
            >
              やめる
            </button>
          </div>
        </div>

        <div class="meta__row">
          <span class="meta__label">期限</span>
          <div class="meta__values">
            <button type="button" class="chip" @click="dueOpen = true">
              {{ dueLabel.state === 'none' ? '設定する' : dueLabel.label }}
            </button>
            <button
              v-if="item.dueAt"
              type="button"
              class="chip chip--quiet"
              @click="patch({ dueAt: null })"
            >
              外す
            </button>
          </div>
        </div>
      </section>

      <section class="body">
        <div class="body__head">
          <h2 class="body__title">本文</h2>
          <span class="body__save" :class="`body__save--${bodySave.state.value}`">
            {{ SAVE_STATE_LABELS[bodySave.state.value] }}
          </span>
        </div>
        <ScrapboxEditor
          ref="bodyEditor"
          v-model="body"
          placeholder="このタスクについてのメモ"
          aria-label="本文"
        />
        <p v-if="bodySave.errorMessage.value" class="page__error" role="alert">
          {{ bodySave.errorMessage.value }}
        </p>
      </section>

      <section v-if="pastOccurrences.length" class="series">
        <h2 class="series__title">この繰り返しの過去分</h2>
        <ul class="series__list">
          <li v-for="past in pastOccurrences" :key="past.id">
            <!-- 分割表示では画面遷移せず、右ペインの表示だけを切り替える -->
            <button
              v-if="embedded"
              type="button"
              class="series__item"
              @click="emit('selectSeries', past.id)"
            >
              <span class="series__due">{{ occurrenceDate(past) }}</span>
              <span class="series__status">{{ STATUS_LABELS[past.status] }}</span>
            </button>
            <NuxtLink v-else class="series__item" :to="`/items/${past.id}`">
              <span class="series__due">{{ occurrenceDate(past) }}</span>
              <span class="series__status">{{ STATUS_LABELS[past.status] }}</span>
            </NuxtLink>
          </li>
        </ul>
      </section>

      <section v-if="sections.length > 1" class="log">
        <h2 class="log__title">これまでの作業記録</h2>
        <ItemSectionEditor
          v-for="section in sections.slice(1)"
          :key="section.id"
          :section="section"
          @save="(value) => saveSection(section, value)"
          @remove="removeSection(section)"
        />
      </section>

      <div class="page__actions">
        <button
          type="button"
          class="page__add"
          :disabled="addingSection"
          @click="addSection"
        >
          今日の作業記録を追加
        </button>
        <button type="button" class="page__delete" @click="remove">
          このタスクを削除
        </button>
      </div>

      <DueDialog v-if="dueOpen" :count="1" @submit="applyDue" @close="dueOpen = false" />

      <RecurrenceDialog
        v-if="recurrenceOpen"
        :count="1"
        :current="recurrence"
        @submit="applyRecurrence"
        @close="recurrenceOpen = false"
      />

      <TagDialog
        v-if="tagOpen"
        :items="[item]"
        @apply="applyTags"
        @close="tagOpen = false"
      />
    </template>
  </div>
</template>

<style scoped>
.page {
  display: grid;
  gap: 1rem;
}

.page__back {
  color: var(--text-muted);
  text-decoration: none;
  font-size: 0.875rem;
  justify-self: start;
}

.page__error {
  margin: 0;
  color: var(--danger);
  font-size: 0.875rem;
}

.page__placeholder {
  margin: 0;
  color: var(--text-muted);
  text-align: center;
  padding: 2rem 0;
}

.head {
  display: grid;
  gap: 0.25rem;
}

.head__title {
  width: 100%;
  resize: none;
  background: transparent;
  border: 0;
  border-bottom: 1px solid transparent;
  outline: none;
  color: var(--text);
  font-size: 1.25rem;
  font-weight: 700;
  line-height: 1.4;
  padding: 0.25rem 0;
  overflow: hidden;
}

.head__title:focus {
  border-bottom-color: var(--border);
}

.head__save,
.body__save {
  font-size: 0.75rem;
  color: var(--text-muted);
  min-height: 1rem;
}

.head__save--error,
.body__save--error {
  color: var(--danger);
}

.meta {
  display: grid;
  gap: 0.625rem;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 0.75rem;
}

.meta__row {
  display: grid;
  gap: 0.375rem;
}

.meta__label {
  display: flex;
  align-items: baseline;
  gap: 0.5rem;
  font-size: 0.8125rem;
  color: var(--text-muted);
}

.meta__open {
  color: var(--accent);
}

.meta__save {
  font-size: 0.75rem;
}

.meta__url {
  font: inherit;
  /* iOS でフォーカス時に自動ズームされないよう 16px を保つ */
  font-size: 1rem;
  width: 100%;
  min-height: 2.75rem;
  padding: 0 0.75rem;
  background: var(--bg);
  color: var(--text);
  border: 1px solid var(--border);
  border-radius: 8px;
}

.meta__values {
  display: flex;
  flex-wrap: wrap;
  gap: 0.375rem;
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

.chip--quiet {
  color: var(--text-muted);
}

.chip--link {
  color: var(--accent);
  text-decoration: none;
  display: inline-flex;
  align-items: center;
}

.body {
  display: grid;
  gap: 0.375rem;
}

.body__head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 0.75rem;
}

.body__title,
.log__title {
  margin: 0;
  font-size: 0.8125rem;
  color: var(--text-muted);
  font-weight: 600;
}

.log,
.series {
  display: grid;
  gap: 0.5rem;
}

.series__title {
  margin: 0;
  font-size: 0.8125rem;
  color: var(--text-muted);
  font-weight: 600;
}

.series__list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: 0.25rem;
}

.series__item {
  width: 100%;
  font: inherit;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 0.5rem 0.75rem;
  min-height: 2.5rem;
  color: inherit;
  text-decoration: none;
  font-size: 0.875rem;
}

.series__due {
  font-variant-numeric: tabular-nums;
}

.series__status {
  color: var(--text-muted);
  font-size: 0.8125rem;
}

.page__actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  gap: 0.5rem;
  padding-top: 0.5rem;
}

.page__add {
  background: transparent;
  border: 1px solid var(--border);
  border-radius: 8px;
  color: var(--text);
  min-height: 2.75rem;
  padding: 0 0.875rem;
}

.page__add:disabled {
  opacity: 0.5;
}

.page__delete {
  background: transparent;
  border: 0;
  color: var(--danger);
  min-height: 2.75rem;
  padding: 0 0.5rem;
  font-size: 0.875rem;
}
</style>
