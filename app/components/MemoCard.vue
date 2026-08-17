<script setup lang="ts">
import type { DisplayMemo } from '~/composables/useMemos'
import { isPending } from '~/composables/useMemos'

const props = defineProps<{ memo: DisplayMemo }>()
const emit = defineEmits<{ remove: [id: string] }>()

const pending = computed(() => isPending(props.memo))

const timeLabel = computed(() =>
  new Intl.DateTimeFormat('ja-JP', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Asia/Tokyo',
  }).format(new Date(props.memo.createdAt)),
)
</script>

<template>
  <article class="card" :class="{ 'card--pending': pending }">
    <div class="card__main">
      <h2 class="card__title">{{ memo.title }}</h2>
      <p v-if="memo.body" class="card__body">{{ memo.body }}</p>
    </div>
    <footer class="card__footer">
      <time class="card__time" :datetime="memo.createdAt">
        {{ pending ? '保存中…' : timeLabel }}
      </time>
      <button
        v-if="!pending"
        type="button"
        class="card__delete"
        :aria-label="`「${memo.title}」を削除`"
        @click="emit('remove', memo.id)"
      >
        削除
      </button>
    </footer>
  </article>
</template>

<style scoped>
.card {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  box-shadow: var(--shadow);
  padding: 0.875rem 1rem;
  display: grid;
  gap: 0.5rem;
}

.card--pending {
  opacity: 0.55;
}

.card__main {
  display: grid;
  gap: 0.25rem;
}

.card__title {
  margin: 0;
  font-size: 1rem;
  font-weight: 600;
  /* 長いタイトルでも横スクロールさせない */
  overflow-wrap: anywhere;
}

.card__body {
  margin: 0;
  color: var(--text-muted);
  font-size: 0.9375rem;
  /* 改行を保ったまま折り返す */
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.card__footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
}

.card__time {
  color: var(--text-muted);
  font-size: 0.8125rem;
  font-variant-numeric: tabular-nums;
}

.card__delete {
  background: transparent;
  border: 0;
  color: var(--danger);
  font-size: 0.8125rem;
  /* タップ目標を確保しつつ、見た目は軽くする */
  min-height: 2.75rem;
  padding: 0 0.5rem;
  margin: -0.5rem -0.5rem -0.5rem 0;
}
</style>
