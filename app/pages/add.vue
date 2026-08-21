<script setup lang="ts">
import { buildItemDraft } from '~/utils/item-draft'

/**
 * 追加だけをする画面（docs/14-app-shortcuts.md）。
 *
 * ホーム画面アイコンの長押しから出る「タスクを追加」の行き先。
 * アプリを開いて一覧の読み込みを待ってから書き始める、という間を
 * 省くための画面なので、置くのは入力欄と、追加できたことの確かめだけ。
 *
 * 保存は一覧・共有の受付と同じ経路（buildItemDraft → useItemStore）を通る。
 * オフラインでも書け、送信は繋がったときに行われる（docs/12-offline.md）。
 */

useHead({ title: 'タスクを追加' })

const store = useItemStore()

const errorMessage = ref<string | null>(null)

/**
 * この画面で追加したもの（新しいものが先）。
 *
 * 入力欄は追加のたびに空になるため、何が入ったかを見せる場所が要る。
 * 続けて追加することもあるので、消さずに積む。
 */
const added = ref<{ id: string; title: string }[]>([])

async function save(text: string) {
  const result = buildItemDraft(text)

  if ('error' in result) {
    errorMessage.value = result.error
    return
  }

  errorMessage.value = null
  // ローカルへ書いて送信の列に積むところまで。送信は待たない
  await store.create(result.draft, text)

  added.value = [
    { id: result.draft.id, title: result.draft.title },
    ...added.value,
  ]
}
</script>

<template>
  <div class="page">
    <h1 class="page__title">タスクを追加</h1>

    <!--
      開いてすぐ書けるように、この画面だけは入力欄にフォーカスする
      （一覧が無いので、キーボード操作を横取りする心配がない）。
      狭い画面でも「＋」を押させず、そのまま出す（inline）。
    -->
    <ItemComposer
      inline
      autofocus
      :multiline="false"
      placeholder="やることを書く（例: 請求書を出す ^今日 !1）"
      @submit="save"
    />

    <p v-if="errorMessage" class="page__error">{{ errorMessage }}</p>

    <section v-if="added.length" class="added">
      <h2 class="added__title">追加しました</h2>
      <ul class="added__list">
        <li v-for="item in added" :key="item.id" class="added__item">
          <NuxtLink class="added__link" :to="`/items/${item.id}`">
            {{ item.title }}
          </NuxtLink>
        </li>
      </ul>
    </section>

    <div class="page__actions">
      <NuxtLink class="button" to="/today">今日を見る</NuxtLink>
      <NuxtLink class="button" to="/">タスクを見る</NuxtLink>
    </div>
  </div>
</template>

<style scoped>
.page {
  display: grid;
  gap: 1rem;
}

.page__title {
  font-size: 1.125rem;
  margin: 0;
}

.page__error {
  color: var(--danger);
  margin: 0;
}

.added {
  display: grid;
  gap: 0.5rem;
}

.added__title {
  margin: 0;
  font-size: 0.875rem;
  font-weight: 600;
  color: var(--text-muted);
}

.added__list {
  margin: 0;
  padding: 0;
  list-style: none;
  display: grid;
  gap: 0.25rem;
}

.added__item {
  /* 長いタイトルでも横に溢れさせない */
  overflow-wrap: anywhere;
}

.added__link {
  color: var(--text);
  text-decoration: none;
  /* タップ目標として十分な高さを確保する */
  display: block;
  padding: 0.375rem 0;
}

.page__actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.75rem;
}

.button {
  min-height: 2.75rem;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0 1.25rem;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--surface);
  color: var(--text);
  font-weight: 600;
  text-decoration: none;
}
</style>
