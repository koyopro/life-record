<script setup lang="ts">
// 一覧の右側に詳細を並べるため、コンテナを広く使う
definePageMeta({ wide: true })

const listView = ref<{ create: (text: string) => Promise<boolean> } | null>(null)

useHead({ title: '今日' })

const today = computed(() =>
  new Intl.DateTimeFormat('ja-JP', {
    month: 'long',
    day: 'numeric',
    weekday: 'short',
    timeZone: 'Asia/Tokyo',
  }).format(new Date()),
)

async function add(text: string) {
  await listView.value?.create(text)
}
</script>

<template>
  <div class="page">
    <header class="head">
      <h1 class="head__title">今日</h1>
      <span class="head__date">{{ today }}</span>
      <!-- list__bar（未完了/完了・グループ・並び・ヘルプ）をここへテレポートする。
           一覧側の別行にすると、その分だけ表示エリアが押し下がるため -->
      <div id="today-list-bar" class="head__bar" />
    </header>

    <ItemComposer
      :multiline="false"
      placeholder="今日やることを追加（例: 請求書を出す ^今日 !1）"
      @submit="add"
    />

    <!--
      期限が今日までに来ている未完了タスクだけを出す。
      「今日やること」の一覧なので、期限なし・完了済み・未来のものは含めない。
    -->
    <ItemListView
      ref="listView"
      status="all"
      due-until-today
      default-sort="priorityDueDesc"
      storage-key="sort:today"
      show-sort
      :show-tag-filter="false"
      bar-target="#today-list-bar"
      empty-message="今日やることはありません。"
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
  font-weight: 700;
}

.head__date {
  color: var(--text-muted);
  font-size: 0.875rem;
}

.head__bar {
  /* list__bar（未完了/完了・グループ・並び・ヘルプ）がテレポートされてくる場所。
     残りの幅をここへ持たせ、タイトルの右側に並べる */
  flex: 1 1 auto;
  min-width: 0;
}
</style>
