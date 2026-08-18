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
    <!-- Inbox は素早く書き込むことが目的なので、開いたらすぐ入力できるようにする -->
    <ItemComposer autofocus @submit="add" />
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
