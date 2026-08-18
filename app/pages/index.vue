<script setup lang="ts">
// 一覧の右側に詳細を並べるため、コンテナを広く使う
definePageMeta({ wide: true })

const listView = ref<{ create: (text: string) => Promise<boolean> } | null>(null)

useHead({ title: 'Inbox' })

async function add(text: string) {
  await listView.value?.create(text)
}
</script>

<template>
  <div class="page">
    <!--
      開いただけでは入力欄にフォーカスしない。フォーカスされていると
      一覧のキーボード操作が入力欄に吸われて使えなくなる。
      書き始めるときは `t` で入力欄へ移る（docs/08-todo-management.md 8.4）。
    -->
    <ItemComposer @submit="add" />
    <ItemListView
      ref="listView"
      status="inbox"
      storage-key="sort:inbox"
      empty-message="Inbox は空です。思いついたことを上の欄に書いてください。"
    />
  </div>
</template>

<style scoped>
.page {
  display: grid;
  gap: 1rem;
}
</style>
