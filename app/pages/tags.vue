<script setup lang="ts">
/**
 * タグ一覧（docs/09-tags.md 9.3）。
 *
 * `g` `s` の移動先。どんなタグを使っているかを一覧で見て、
 * そこから絞り込んだタスク一覧へ入るための入口。
 */
const { tags, pending } = useTags()

useHead({ title: 'タグ' })

/**
 * そのタグのタスク一覧へのリンク。
 *
 * 件数は status を問わず数えているので、一覧側も「すべて」に合わせる。
 * 既定の「未着手」に送ると、件数と表示件数が食い違って見える。
 */
function to(name: string) {
  return { path: '/items', query: { status: 'all', tag: name } }
}
</script>

<template>
  <div class="page">
    <h1 class="page__title">タグ</h1>

    <p v-if="pending && !tags.length" class="page__placeholder">読み込み中…</p>

    <p v-else-if="!tags.length" class="page__placeholder">
      タグはまだありません。タスクに <code>#タグ名</code> を付けるとここに並びます。
    </p>

    <ul v-else class="tags">
      <li v-for="tag in tags" :key="tag.id">
        <NuxtLink class="tags__item" :to="to(tag.name)">
          <span class="tags__name">#{{ tag.name }}</span>
          <span class="tags__count">{{ tag.count }}</span>
        </NuxtLink>
      </li>
    </ul>

    <NuxtLink class="page__untagged" :to="{ path: '/items', query: { status: 'all', untagged: 'true' } }">
      タグなしのタスクを見る
    </NuxtLink>
  </div>
</template>

<style scoped>
.page {
  display: grid;
  gap: 1rem;
}

.page__title {
  margin: 0;
  font-size: 1.25rem;
  font-weight: 700;
}

.page__placeholder {
  margin: 0;
  color: var(--text-muted);
  font-size: 0.9375rem;
}

.tags {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: 0.375rem;
}

.tags__item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  /* タップ目標として十分な大きさを確保する */
  min-height: 2.75rem;
  padding: 0 0.875rem;
  color: var(--text);
  text-decoration: none;
}

.tags__name {
  font-weight: 600;
  overflow-wrap: anywhere;
}

.tags__count {
  color: var(--text-muted);
  font-size: 0.8125rem;
  font-variant-numeric: tabular-nums;
}

.page__untagged {
  color: var(--text-muted);
  font-size: 0.875rem;
}
</style>
