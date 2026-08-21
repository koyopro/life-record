<script setup lang="ts">
import {
  ITEM_STATUSES,
  PRIORITIES,
  PRIORITY_LABELS,
  STATUS_LABELS,
  type ItemDto,
  type ItemStatus,
  type Priority,
} from '~~/shared/types/item'

/**
 * タスクの操作をまとめたシート（docs/08-todo-management.md 8.4）。
 *
 * 長押しした1件と、チェックしたタスクのまとめて操作の両方から開く。
 * どちらも「対象に対して同じことをする」だけなので、対象を配列で受けて
 * 1つの部品で兼ねる。
 */
const props = defineProps<{ items: ItemDto[] }>()

const emit = defineEmits<{
  status: [value: ItemStatus]
  priority: [value: Priority | null]
  due: []
  tags: []
  recurrence: []
  postpone: []
  open: []
  remove: []
  close: []
}>()

const title = computed(() =>
  props.items.length === 1
    ? props.items[0]!.title
    : `${props.items.length}件を選択中`,
)

/**
 * いまの値。対象すべてが同じときだけ返す。
 *
 * まとめて操作するとき、対象の値がばらばらなら「いまこれ」と示せない。
 * その場合はどのボタンも点灯させず、押した値に揃うことだけを示す。
 */
function shared<T>(pick: (item: ItemDto) => T): T | undefined {
  const [first, ...rest] = props.items
  if (!first) return undefined
  const value = pick(first)
  return rest.every((item) => pick(item) === value) ? value : undefined
}

const status = computed(() => shared((item) => item.status))
const priority = computed(() => shared((item) => item.priority))
</script>

<template>
  <!--
    スマートフォンではキーボードショートカットが使えないため、
    長押し・チェックから同じ操作へ到達できるようにする。
  -->
  <div class="overlay" @click.self="emit('close')">
    <div class="sheet" role="dialog" aria-modal="true" :aria-label="title">
      <p class="sheet__title">{{ title }}</p>

      <!-- 状態は `b` / `w` / `c`、重要度は `1`〜`4` に当たる -->
      <div class="sheet__row" role="group" aria-label="状態">
        <button
          v-for="value in ITEM_STATUSES"
          :key="value"
          type="button"
          class="sheet__choice"
          :class="{ 'sheet__choice--active': status === value }"
          @click="emit('status', value)"
        >
          {{ STATUS_LABELS[value] }}
        </button>
      </div>

      <div class="sheet__row" role="group" aria-label="重要度">
        <button
          v-for="value in PRIORITIES"
          :key="value"
          type="button"
          class="sheet__choice"
          :class="{ 'sheet__choice--active': priority === value }"
          @click="emit('priority', value)"
        >
          重要度{{ PRIORITY_LABELS[value] }}
        </button>
        <button
          type="button"
          class="sheet__choice"
          :class="{ 'sheet__choice--active': priority === null }"
          @click="emit('priority', null)"
        >
          なし
        </button>
      </div>

      <button type="button" class="sheet__action" @click="emit('due')">
        期限を設定
      </button>
      <button type="button" class="sheet__action" @click="emit('postpone')">
        期限を明日にする
      </button>
      <button type="button" class="sheet__action" @click="emit('tags')">
        タグを変更
      </button>
      <button type="button" class="sheet__action" @click="emit('recurrence')">
        繰り返しを設定
      </button>
      <!-- 詳細は1つの画面にしか出せないので、1件のときだけ -->
      <button
        v-if="items.length === 1"
        type="button"
        class="sheet__action"
        @click="emit('open')"
      >
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

/* 選ぶだけのもの（状態・重要度）は横に並べて、1タップで終わらせる */
.sheet__row {
  display: grid;
  grid-auto-flow: column;
  grid-auto-columns: 1fr;
  gap: 0.375rem;
}

.sheet__choice {
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 10px;
  color: var(--text);
  min-height: 2.75rem;
  padding: 0 0.25rem;
  font-size: 0.8125rem;
}

/* いまの値。対象がばらばらならどれも点灯しない */
.sheet__choice--active {
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
