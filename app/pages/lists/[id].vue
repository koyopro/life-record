<script setup lang="ts">
import type { GroupKey, SortKey } from '~~/shared/types/item'
import type { SmartListInput } from '~~/shared/types/smart-list'
import { withTagDefaults } from '~~/shared/utils/smart-add'

/**
 * スマートリスト（docs/08-todo-management.md 8.6）。
 *
 * リストが持っている条件（タグ・表示方法・グループ順・並び）で一覧を出す。
 * 並び・グループ順をここで選び直したときは、その場の見え方だけでなく
 * リストそのものを直す。次に開いたときも同じ見え方にするため。
 */
definePageMeta({ wide: true })

const route = useRoute()
const id = computed(() => String(route.params.id))

const { byId, loaded, update } = useSmartLists()

const list = computed(() => byId(id.value))

const title = computed(() => list.value?.name ?? 'リスト')
useHead({ title })

const editing = ref(false)
const errorMessage = ref<string | null>(null)

const listView = ref<{ create: (text: string) => Promise<boolean> } | null>(null)

// リストのタグで絞り込んでいるなら、追加にもそのタグを足す
// （付けないと、追加した途端にこのリストから消える）
async function add(text: string) {
  await listView.value?.create(withTagDefaults(text, list.value?.tag))
}

/** いまの中身に1か所だけ差し替えて保存する。 */
async function save(patch: Partial<SmartListInput>) {
  const current = list.value
  if (!current) return

  errorMessage.value = null
  try {
    await update(current.id, {
      name: current.name,
      tag: current.tag,
      view: current.view,
      groupBy: current.groupBy,
      sort: current.sort,
      ...patch,
    })
  } catch {
    errorMessage.value = 'リストを保存できませんでした（オフラインかもしれません）'
  }
}

async function submitEdit(input: SmartListInput) {
  await save(input)
  editing.value = false
}
</script>

<template>
  <div class="page">
    <header class="head">
      <h1 class="head__title">{{ list?.name ?? 'リスト' }}</h1>
      <button
        v-if="list"
        type="button"
        class="head__edit"
        :aria-label="`「${list.name}」を編集`"
        @click="editing = true"
      >
        <span aria-hidden="true">✎</span>
      </button>
      <!-- list__bar（グループ・並び・ヘルプ）をここへテレポートする -->
      <div id="list-list-bar" class="head__bar" />
    </header>

    <p v-if="errorMessage" class="page__error" role="alert">{{ errorMessage }}</p>

    <p v-if="!list && !loaded" class="page__placeholder">読み込み中…</p>

    <p v-else-if="!list" class="page__placeholder">
      このリストは見つかりませんでした。
      <NuxtLink to="/lists">リスト一覧へ戻る</NuxtLink>
    </p>

    <template v-else>
      <ItemComposer
        :multiline="false"
        placeholder="タスクを追加（例: 請求書を出す ^今日 !1）"
        @submit="add"
      />

      <!--
        リストの条件で出す。タグは URL ではなくリストが持っているので、
        絞り込みのバー（タグ）は出さない。
      -->
      <ItemListView
        :key="list.id"
        ref="listView"
        status="all"
        :view="list.view"
        :fixed-tag="list.tag"
        :sort="list.sort"
        :group="list.groupBy"
        show-sort
        :show-tag-filter="false"
        bar-target="#list-list-bar"
        empty-message="このリストに当てはまるタスクはありません。"
        @update:sort="(value: SortKey) => save({ sort: value })"
        @update:group="(value: GroupKey) => save({ groupBy: value })"
      />
    </template>

    <SmartListDialog
      v-if="editing && list"
      :list="list"
      @submit="submitEdit"
      @close="editing = false"
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
  overflow-wrap: anywhere;
}

.head__edit {
  font: inherit;
  width: 2rem;
  min-height: 2rem;
  border: 1px solid var(--border);
  border-radius: 999px;
  background: transparent;
  color: var(--text-muted);
}

/* 残った幅は一覧のバーが持つ。狭いときは次の行へ回る */
.head__bar {
  flex: 1 1 auto;
  min-width: 0;
  display: flex;
  justify-content: flex-end;
}

/*
 * 狭い画面では入れ物を透明にし、中身（グループ・並び）を見出しと同じ
 * 並びへ差し出す（ItemListView の 40rem 以下の指定と対）。
 */
@media (max-width: 40rem) {
  .head__bar {
    display: contents;
  }
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
</style>
