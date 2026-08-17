<script setup lang="ts">
const { memos, loading, error, submitError, addMemo, removeMemo } = useMemos()

useHead({ title: 'Inbox' })
</script>

<template>
  <main class="page">
    <header class="page__header">
      <h1 class="page__title">Inbox</h1>
      <span v-if="memos.length" class="page__count">{{ memos.length }}</span>
    </header>

    <MemoComposer @submit="addMemo" />

    <p v-if="submitError" class="page__error" role="alert">
      {{ submitError }}
    </p>

    <p v-if="error" class="page__error" role="alert">
      メモを読み込めませんでした
    </p>

    <p v-else-if="loading && !memos.length" class="page__status">読み込み中…</p>

    <p v-else-if="!memos.length" class="page__status">
      まだメモはありません。<br />
      思いついたことを上の欄に書いてください。
    </p>

    <ul v-else class="page__list">
      <li v-for="memo in memos" :key="memo.id">
        <MemoCard :memo="memo" @remove="removeMemo" />
      </li>
    </ul>
  </main>
</template>

<style scoped>
.page {
  /* スマートフォンでの片手操作を基準に、幅は読みやすい範囲に留める */
  max-width: 40rem;
  margin: 0 auto;
  padding: 1rem 1rem 4rem;
  display: grid;
  gap: 1rem;
}

.page__header {
  display: flex;
  align-items: baseline;
  gap: 0.5rem;
}

.page__title {
  margin: 0;
  font-size: 1.25rem;
  font-weight: 700;
}

.page__count {
  color: var(--text-muted);
  font-size: 0.875rem;
  font-variant-numeric: tabular-nums;
}

.page__list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: 0.625rem;
}

.page__status {
  margin: 0;
  color: var(--text-muted);
  text-align: center;
  padding: 2rem 0;
}

.page__error {
  margin: 0;
  color: var(--danger);
  font-size: 0.875rem;
}
</style>
