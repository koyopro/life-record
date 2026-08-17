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
} from '~~/shared/types/item'

const route = useRoute()
const id = computed(() => String(route.params.id))

const { data: item, error, refresh } = await useFetch<ItemDetailDto>(
  () => `/api/items/${id.value}`,
)

useHead(() => ({ title: item.value?.title ?? 'タスク' }))

// --- タイトル（リアルタイム保存） --------------------------------------

const title = ref(item.value?.title ?? '')

const titleSave = useAutosave({
  source: title,
  // 空のまま保存するとサーバー側で弾かれるので、入力中は送らない
  enabled: () => title.value.trim().length > 0,
  save: async (value) => {
    await $fetch(`/api/items/${id.value}`, {
      method: 'PATCH',
      body: { title: value.trim() },
    })
  },
})

// --- 本文（リアルタイム保存） ------------------------------------------
//
// Item は本文を持たないため、本文は先頭 Section に書く
// （docs/02-data-model.md 2.9-1）。Section がなければ最初の保存時に作る。

const sections = computed<SectionDto[]>(() => item.value?.sections ?? [])
const primarySection = computed<SectionDto | null>(() => sections.value[0] ?? null)

const body = ref(primarySection.value?.body ?? '')
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

// --- メタデータの操作 ---------------------------------------------------

const actionError = ref<string | null>(null)

async function patch(values: Record<string, unknown>) {
  actionError.value = null
  try {
    await $fetch(`/api/items/${id.value}`, { method: 'PATCH', body: values })
    await refresh()
  } catch {
    actionError.value = '更新できませんでした'
  }
}

const dueOpen = ref(false)

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
  await navigateTo('/items')
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

    <template v-else-if="item">
      <NuxtLink to="/items" class="page__back">← 一覧へ</NuxtLink>

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
        <textarea
          v-model="body"
          class="body__input"
          rows="6"
          placeholder="このタスクについてのメモ"
          aria-label="本文"
        />
        <p v-if="bodySave.errorMessage.value" class="page__error" role="alert">
          {{ bodySave.errorMessage.value }}
        </p>
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
  font-size: 0.8125rem;
  color: var(--text-muted);
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

.body__input {
  width: 100%;
  min-height: 9rem;
  resize: vertical;
  background: var(--surface);
  color: var(--text);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 0.75rem;
  outline: none;
  line-height: 1.7;
}

.body__input:focus {
  border-color: var(--accent);
}

.log {
  display: grid;
  gap: 0.5rem;
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
