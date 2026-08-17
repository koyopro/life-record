<script setup lang="ts">
import { PRIORITIES, PRIORITY_LABELS, type ItemDto } from '~~/shared/types/item'

defineProps<{ item: ItemDto }>()

const emit = defineEmits<{
  complete: []
  priority: [value: 1 | 2 | 3 | null]
  due: []
  tags: []
  recurrence: []
  postpone: []
  open: []
  remove: []
  close: []
}>()
</script>

<template>
  <!--
    スマートフォンではキーボードショートカットが使えないため、
    長押しから同じ操作へ到達できるようにする（docs/08-todo-management.md 8.3）。
  -->
  <div class="overlay" @click.self="emit('close')">
    <div class="sheet" role="dialog" aria-modal="true" :aria-label="item.title">
      <p class="sheet__title">{{ item.title }}</p>

      <button type="button" class="sheet__action" @click="emit('complete')">
        {{ item.status === 'closed' ? '未完了に戻す' : '完了にする' }}
      </button>

      <div class="sheet__priorities">
        <button
          v-for="value in PRIORITIES"
          :key="value"
          type="button"
          class="sheet__priority"
          :class="{ 'sheet__priority--active': item.priority === value }"
          @click="emit('priority', value)"
        >
          重要度{{ PRIORITY_LABELS[value] }}
        </button>
        <button
          type="button"
          class="sheet__priority"
          :class="{ 'sheet__priority--active': item.priority === null }"
          @click="emit('priority', null)"
        >
          なし
        </button>
      </div>

      <button type="button" class="sheet__action" @click="emit('due')">
        期限を設定
      </button>
      <button type="button" class="sheet__action" @click="emit('postpone')">
        期限を1日延ばす
      </button>
      <button type="button" class="sheet__action" @click="emit('tags')">
        タグを変更
      </button>
      <button type="button" class="sheet__action" @click="emit('recurrence')">
        繰り返しを設定
      </button>
      <button type="button" class="sheet__action" @click="emit('open')">
        詳細を開く
      </button>
      <button
        type="button"
        class="sheet__action sheet__action--danger"
        @click="emit('remove')"
      >
        削除
      </button>

      <button type="button" class="sheet__cancel" @click="emit('close')">
        キャンセル
      </button>
    </div>
  </div>
</template>

<style scoped>
.overlay {
  position: fixed;
  inset: 0;
  background: rgb(0 0 0 / 45%);
  display: flex;
  align-items: flex-end;
  justify-content: center;
  z-index: 20;
}

.sheet {
  background: var(--surface);
  border-top-left-radius: 16px;
  border-top-right-radius: 16px;
  width: min(30rem, 100%);
  padding: 0.75rem 0.75rem calc(0.75rem + env(safe-area-inset-bottom));
  display: grid;
  gap: 0.375rem;
}

.sheet__title {
  margin: 0 0 0.25rem;
  padding: 0 0.5rem;
  font-size: 0.8125rem;
  color: var(--text-muted);
  overflow-wrap: anywhere;
}

.sheet__action {
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 10px;
  color: var(--text);
  min-height: 2.75rem;
  padding: 0 0.875rem;
  text-align: left;
}

.sheet__action--danger {
  color: var(--danger);
}

.sheet__priorities {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 0.375rem;
}

.sheet__priority {
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 10px;
  color: var(--text);
  min-height: 2.75rem;
  padding: 0 0.25rem;
  font-size: 0.8125rem;
}

.sheet__priority--active {
  border-color: var(--accent);
  color: var(--accent);
  font-weight: 600;
}

.sheet__cancel {
  background: transparent;
  border: 0;
  color: var(--text-muted);
  min-height: 2.75rem;
  margin-top: 0.25rem;
}
</style>
