<script setup lang="ts">
import { PRIORITY_LABELS, type ItemDto } from '~~/shared/types/item'
import { describeRecurrence } from '~~/shared/utils/recurrence'
import { toPlainText } from '~~/shared/utils/scrapbox/render'

const props = defineProps<{
  item: ItemDto
  focused?: boolean
  selected?: boolean
}>()

const emit = defineEmits<{
  select: []
  focus: []
  complete: []
  open: []
  longpress: []
  filterTag: [tag: string]
}>()

/** 抜粋では記法を出さず、中身だけを見せる。 */
const bodyExcerpt = computed(() =>
  props.item.body ? toPlainText(props.item.body) : '',
)

const due = computed(() => formatDue(props.item))
const done = computed(() => props.item.status === 'closed')

const recurrenceLabel = computed(() => {
  const { recurrenceRule, recurrenceBasis } = props.item
  if (!recurrenceRule || !recurrenceBasis) return null
  return describeRecurrence({ rule: recurrenceRule, basis: recurrenceBasis })
})

// --- タッチ操作（docs/08-todo-management.md 8.4） -----------------------
// PC のショートカットに相当する操作を、スマートフォンでも行えるようにする。

const SWIPE_THRESHOLD = 72
const LONG_PRESS_MS = 500

const dragX = ref(0)
const dragging = ref(false)
let startX = 0
let startY = 0
let longPressTimer: ReturnType<typeof setTimeout> | undefined

function cancelLongPress() {
  if (longPressTimer) clearTimeout(longPressTimer)
  longPressTimer = undefined
}

function onTouchStart(event: TouchEvent) {
  const touch = event.touches[0]
  if (!touch) return
  startX = touch.clientX
  startY = touch.clientY
  dragging.value = true
  longPressTimer = setTimeout(() => {
    dragging.value = false
    dragX.value = 0
    emit('longpress')
  }, LONG_PRESS_MS)
}

function onTouchMove(event: TouchEvent) {
  const touch = event.touches[0]
  if (!touch || !dragging.value) return

  const deltaX = touch.clientX - startX
  const deltaY = touch.clientY - startY

  // 縦方向の動きが大きければスクロール操作とみなす
  if (Math.abs(deltaY) > Math.abs(deltaX)) {
    cancelLongPress()
    dragging.value = false
    dragX.value = 0
    return
  }

  cancelLongPress()
  // 右スワイプのみ受け付ける（左は誤操作が多いため）
  dragX.value = Math.max(0, Math.min(deltaX, 120))
}

function onTouchEnd() {
  cancelLongPress()
  if (dragging.value && dragX.value >= SWIPE_THRESHOLD && !done.value) {
    emit('complete')
  }
  dragging.value = false
  dragX.value = 0
}
</script>

<template>
  <article
    class="card"
    :class="{
      'card--focused': focused,
      'card--selected': selected,
      'card--done': done,
    }"
    :style="{ transform: dragX ? `translateX(${dragX}px)` : undefined }"
    @click="emit('focus')"
    @touchstart.passive="onTouchStart"
    @touchmove.passive="onTouchMove"
    @touchend="onTouchEnd"
    @touchcancel="onTouchEnd"
  >
    <div
      v-if="dragX > 0"
      class="card__swipe-hint"
      :class="{ 'card__swipe-hint--armed': dragX >= 72 }"
      aria-hidden="true"
    >
      ✓
    </div>

    <button
      type="button"
      class="card__check"
      :aria-label="done ? `「${item.title}」を未完了に戻す` : `「${item.title}」を完了にする`"
      :aria-pressed="done"
      @click.stop="emit('complete')"
    >
      <span class="card__check-box">{{ done ? '✓' : '' }}</span>
    </button>

    <div class="card__main">
      <button type="button" class="card__title" @click.stop="emit('open')">
        {{ item.title }}
      </button>
      <p v-if="bodyExcerpt" class="card__body">{{ bodyExcerpt }}</p>
      <div
        v-if="item.priority || due.state !== 'none' || item.tags.length || recurrenceLabel"
        class="card__meta"
      >
        <span v-if="recurrenceLabel" class="card__recurrence" :title="recurrenceLabel">
          <span aria-hidden="true">↻</span>
          <span class="card__recurrence-text">{{ recurrenceLabel }}</span>
        </span>
        <span
          v-if="item.priority"
          class="card__priority"
          :class="`card__priority--${item.priority}`"
        >
          重要度{{ PRIORITY_LABELS[item.priority] }}
        </span>
        <span
          v-if="due.state !== 'none'"
          class="card__due"
          :class="`card__due--${due.state}`"
        >
          {{ due.label }}
        </span>
        <a
          v-if="item.url"
          class="card__url"
          :href="item.url"
          target="_blank"
          rel="noopener noreferrer"
          :aria-label="`「${item.title}」のリンクを開く`"
          @click.stop
        >
          <span aria-hidden="true">↗</span> リンク
        </a>
        <button
          v-for="tag in item.tags"
          :key="tag"
          type="button"
          class="card__tag"
          :aria-label="`タグ「${tag}」で絞り込む`"
          @click.stop="emit('filterTag', tag)"
        >
          #{{ tag }}
        </button>
      </div>
    </div>

    <button
      type="button"
      class="card__select"
      :aria-label="`「${item.title}」を選択`"
      :aria-pressed="selected"
      @click.stop="emit('select')"
    >
      {{ selected ? '☑' : '☐' }}
    </button>
  </article>
</template>

<style scoped>
.card {
  position: relative;
  background: var(--surface);
  border: 1px solid var(--border);
  border-left: 3px solid transparent;
  border-radius: var(--radius);
  box-shadow: var(--shadow);
  padding: 0.75rem 0.5rem 0.75rem 0.75rem;
  display: flex;
  align-items: flex-start;
  gap: 0.5rem;
  transition: transform 0.15s ease;
}

/* カーソル位置。キーボード操作の対象がどれかを常に見えるようにする */
.card--focused {
  border-left-color: var(--accent);
  box-shadow:
    var(--shadow),
    0 0 0 2px color-mix(in srgb, var(--accent) 35%, transparent);
}

.card--selected {
  background: color-mix(in srgb, var(--accent) 8%, var(--surface));
}

.card--done .card__title {
  text-decoration: line-through;
  color: var(--text-muted);
}

.card__swipe-hint {
  position: absolute;
  left: -2.5rem;
  top: 50%;
  transform: translateY(-50%);
  color: var(--text-muted);
  font-size: 1.25rem;
}

.card__swipe-hint--armed {
  color: var(--accent);
}

.card__check {
  background: transparent;
  border: 0;
  padding: 0.25rem;
  /* タップ目標を確保する */
  min-width: 2.25rem;
  min-height: 2.25rem;
  display: grid;
  place-items: center;
}

.card__check-box {
  width: 1.25rem;
  height: 1.25rem;
  border: 1.5px solid var(--border);
  border-radius: 4px;
  display: grid;
  place-items: center;
  font-size: 0.875rem;
  line-height: 1;
  color: var(--accent);
}

.card__main {
  flex: 1;
  min-width: 0;
  display: grid;
  gap: 0.25rem;
}

.card__title {
  background: transparent;
  border: 0;
  padding: 0;
  text-align: left;
  font-size: 1rem;
  font-weight: 600;
  color: inherit;
  overflow-wrap: anywhere;
}

.card__body {
  margin: 0;
  color: var(--text-muted);
  font-size: 0.9375rem;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  /* 一覧では3行に抑える。全文は詳細で読む */
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.card__meta {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  font-size: 0.8125rem;
}

.card__priority {
  font-weight: 600;
}

.card__priority--1 {
  color: var(--danger);
}

.card__priority--2 {
  color: var(--accent);
}

.card__priority--3 {
  color: var(--text-muted);
}

.card__due {
  color: var(--text-muted);
  font-variant-numeric: tabular-nums;
}

.card__due--overdue {
  color: var(--danger);
  font-weight: 600;
}

.card__due--today {
  color: var(--accent);
  font-weight: 600;
}

.card__recurrence {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
  color: var(--text-muted);
}

.card__recurrence-text {
  /* 狭い画面ではアイコンだけにする */
  display: none;
}

@media (min-width: 26rem) {
  .card__recurrence-text {
    display: inline;
  }
}

.card__url {
  color: var(--accent);
  text-decoration: none;
}

.card__tag {
  background: transparent;
  border: 0;
  padding: 0;
  color: var(--accent);
  font-size: 0.8125rem;
  overflow-wrap: anywhere;
}

.card__select {
  background: transparent;
  border: 0;
  color: var(--text-muted);
  min-width: 2.25rem;
  min-height: 2.25rem;
}
</style>
