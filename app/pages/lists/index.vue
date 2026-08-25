<script setup lang="ts">
import { GROUP_LABELS, SORT_LABELS } from '~~/shared/types/item'
import {
  LIST_VIEW_LABELS,
  type SmartListDto,
  type SmartListInput,
} from '~~/shared/types/smart-list'

/**
 * スマートリスト一覧（docs/08-todo-management.md 8.6）。
 *
 * 作ったリストを見て、そこから開くための入口。`g` `m` は特定のリストへ
 * 直接移れる別の入口（app.vue の GoToSmartListDialog）を使う。
 */
const { lists, loaded, create, update, remove } = useSmartLists()
const { ask } = useConfirm()

useHead({ title: 'リスト' })

/** 開いているフォーム。`new` なら新規、リストなら編集。 */
const editing = ref<SmartListDto | 'new' | null>(null)
const errorMessage = ref<string | null>(null)

/** その条件を1行で読めるようにする。開かなくても中身が分かるように。 */
function describe(list: SmartListDto): string {
  const parts = [
    list.tag ? `#${list.tag}` : 'すべてのタスク',
    LIST_VIEW_LABELS[list.view],
    SORT_LABELS[list.sort],
  ]
  if (list.groupBy !== 'none') parts.push(`${GROUP_LABELS[list.groupBy]}でグループ`)
  return parts.join(' ・ ')
}

async function submit(input: SmartListInput) {
  const target = editing.value
  if (!target) return

  errorMessage.value = null
  try {
    if (target === 'new') await create(input)
    else await update(target.id, input)
    editing.value = null
  } catch {
    errorMessage.value = '保存できませんでした（オフラインかもしれません）'
  }
}

async function removeList(list: SmartListDto) {
  const ok = await ask({
    message: `「${list.name}」を削除します。タスクは消えません。`,
    confirmLabel: '削除',
    danger: true,
  })
  if (!ok) return

  errorMessage.value = null
  try {
    await remove(list.id)
  } catch {
    errorMessage.value = '削除できませんでした（オフラインかもしれません）'
  }
}
</script>

<template>
  <div class="page">
    <header class="head">
      <h1 class="page__title">リスト</h1>
      <button type="button" class="head__add" @click="editing = 'new'">
        ＋ 新しいリスト
      </button>
    </header>

    <p class="page__note">
      よく見る絞り込みに名前を付けて残しておけます。<code>g</code> <code>m</code>
      でここのリストへ直接移れます。
    </p>

    <p v-if="errorMessage" class="page__error" role="alert">{{ errorMessage }}</p>

    <p v-if="!loaded && !lists.length" class="page__placeholder">読み込み中…</p>

    <p v-else-if="!lists.length" class="page__placeholder">
      リストはまだありません。
    </p>

    <ul v-else class="lists">
      <li v-for="list in lists" :key="list.id" class="lists__row">
        <NuxtLink class="lists__item" :to="`/lists/${list.id}`">
          <span class="lists__name">{{ list.name }}</span>
          <span class="lists__conditions">{{ describe(list) }}</span>
        </NuxtLink>
        <button
          type="button"
          class="lists__control"
          :aria-label="`「${list.name}」を編集`"
          @click="editing = list"
        >
          <span aria-hidden="true">✎</span>
        </button>
        <button
          type="button"
          class="lists__control lists__control--danger"
          :aria-label="`「${list.name}」を削除`"
          @click="removeList(list)"
        >
          <span aria-hidden="true">✕</span>
        </button>
      </li>
    </ul>

    <SmartListDialog
      v-if="editing"
      :list="editing === 'new' ? null : editing"
      @submit="submit"
      @close="editing = null"
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
  gap: 0.75rem;
}

.page__title {
  margin: 0;
  font-size: 1.25rem;
  flex: 1;
}

.head__add {
  font: inherit;
  font-size: 0.875rem;
  min-height: 2.25rem;
  padding: 0 0.75rem;
  border: 1px solid var(--border);
  border-radius: 999px;
  background: transparent;
  color: var(--text);
  white-space: nowrap;
}

.page__note {
  margin: 0;
  color: var(--text-muted);
  font-size: 0.8125rem;
}

.page__note code {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 4px;
  padding: 0 0.25rem;
}

.page__error {
  margin: 0;
  color: var(--danger);
  font-size: 0.875rem;
}

.page__placeholder {
  margin: 0;
  color: var(--text-muted);
  font-size: 0.875rem;
}

.lists {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: 0.375rem;
}

.lists__row {
  display: flex;
  align-items: stretch;
  gap: 0.25rem;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius);
}

.lists__item {
  flex: 1;
  min-width: 0;
  display: grid;
  gap: 0.125rem;
  padding: 0.625rem 0.75rem;
  color: var(--text);
  text-decoration: none;
}

.lists__name {
  overflow-wrap: anywhere;
}

.lists__conditions {
  color: var(--text-muted);
  font-size: 0.8125rem;
}

.lists__control {
  flex: 0 0 auto;
  width: 2.5rem;
  background: transparent;
  border: 0;
  color: var(--text-muted);
  font: inherit;
}

.lists__control--danger:hover {
  color: var(--danger);
}
</style>
