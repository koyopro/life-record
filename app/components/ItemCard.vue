<script setup lang="ts">
import { PRIORITY_LABELS, type ItemDto } from '~~/shared/types/item'
import { describeRecurrence } from '~~/shared/utils/recurrence'

const props = defineProps<{
  item: ItemDto
  focused?: boolean
  selected?: boolean
  /** まだサーバーへ送れていない変更を抱えているか（docs/12-offline.md 12.8）。 */
  pending?: boolean
}>()

const emit = defineEmits<{
  select: []
  focus: []
  complete: []
  open: []
  longpress: []
  filterTag: [tag: string]
}>()

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
    :class="[
      `card--priority-${item.priority ?? 'none'}`,
      {
        'card--focused': focused,
        'card--selected': selected,
        'card--done': done,
      },
    ]"
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

    <!--
      左端はタスクの選択。完了は `c` / スワイプ / 長押しメニューで行う
      （docs/08-todo-management.md 8.4）。同じ形の四角を2つ並べると
      どちらが何なのか読み取れないため、押せる四角はこれ1つにする。
    -->
    <button
      type="button"
      class="card__select"
      :aria-label="`「${item.title}」を選択`"
      :aria-pressed="selected"
      @click.stop="emit('select')"
    >
      <span class="card__select-box">{{ selected ? '✓' : '' }}</span>
    </button>

    <div class="card__main">
      <!--
        タイトルが短ければ、期限は右側に同じ行で収まる（RTM に倣う）。
        長いタイトルは折り返すが、期限はその1行目の高さに留まる。
      -->
      <div class="card__head">
        <button type="button" class="card__title" @click.stop="emit('open')">
          {{ item.title }}
        </button>
        <span
          v-if="due.state !== 'none'"
          class="card__due"
          :class="`card__due--${due.state}`"
        >
          {{ due.label }}
        </span>
      </div>
      <!--
        重要度は左端の色で表している（.card--priority-*）。文字では出さないが、
        色だけが手がかりになるのを避けるため、読み上げ用の名前だけ残す。
      -->
      <span v-if="item.priority" class="card__priority">
        重要度{{ PRIORITY_LABELS[item.priority] }}
      </span>
      <div
        v-if="item.tags.length || recurrenceLabel || pending"
        class="card__meta"
      >
        <!-- この端末にだけある変更。オフライン中に書いたものが分かるように -->
        <span
          v-if="pending"
          class="card__pending"
          title="まだサーバーへ送れていない変更があります"
        >
          <span aria-hidden="true">●</span> 未同期
        </span>
        <span v-if="recurrenceLabel" class="card__recurrence" :title="recurrenceLabel">
          <span aria-hidden="true">↻</span>
          <span class="card__recurrence-text">{{ recurrenceLabel }}</span>
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
  </article>
</template>

<style scoped>
.card {
  position: relative;
  background: var(--surface);
  border: 1px solid var(--border);
  border-left: 4px solid var(--priority-none);
  border-radius: var(--radius);
  box-shadow: var(--shadow);
  /* 左端の四角は自前で余白を持つので、その分だけ詰める */
  padding: 0.5rem 0.75rem 0.5rem 0.5rem;
  display: flex;
  align-items: flex-start;
  gap: 0.5rem;
  transition: transform 0.15s ease;
}

/*
 * 重要度は左端の帯で示す（docs/08-todo-management.md 8.1）。
 * 一覧を眺めたときに、読まずに優先度が分かるようにするため。
 * 重要度なしは既定の灰色（`.card` の指定）のまま。
 * 色だけに頼らないよう、「重要度高」の文字は meta に残す。
 */
.card--priority-1 {
  border-left-color: var(--priority-1);
}

.card--priority-2 {
  border-left-color: var(--priority-2);
}

.card--priority-3 {
  border-left-color: var(--priority-3);
}

/*
 * カーソル位置。キーボード操作の対象がどれかを常に見えるようにする。
 * 左端は重要度に使うので、囲みの線だけで示す。
 */
.card--focused {
  box-shadow:
    var(--shadow),
    0 0 0 2px color-mix(in srgb, var(--accent) 45%, transparent);
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

.card__select {
  background: transparent;
  border: 0;
  padding: 0.125rem;
  /* タップ目標を確保しつつ、行の高さはタイトルの文字サイズに近づける（RTM に倣う） */
  min-width: 1.75rem;
  min-height: 1.75rem;
  display: grid;
  place-items: center;
}

.card__select-box {
  width: 1.125rem;
  height: 1.125rem;
  border: 1.5px solid var(--border);
  border-radius: 4px;
  display: grid;
  place-items: center;
  font-size: 0.875rem;
  line-height: 1;
  color: var(--accent);
}

.card--selected .card__select-box {
  background: var(--accent);
  border-color: var(--accent);
  color: var(--accent-text);
}

.card__main {
  flex: 1;
  min-width: 0;
  display: grid;
  gap: 0.125rem;
}

.card__head {
  display: flex;
  align-items: baseline;
  gap: 0.5rem;
}

.card__title {
  flex: 1;
  min-width: 0;
  background: transparent;
  border: 0;
  padding: 0;
  text-align: left;
  font-size: 1rem;
  font-weight: 600;
  color: inherit;
  overflow-wrap: anywhere;
}

.card__meta {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  font-size: 0.8125rem;
}

/* 読み上げにだけ残す。場所を取らせない（表示は左端の色が担う） */
.card__priority {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
}

/* 未同期は状態の説明であって、優先度の高い情報ではない。控えめに出す */
.card__pending {
  color: var(--text-muted);
  font-size: 0.75rem;
}

.card__due {
  flex-shrink: 0;
  white-space: nowrap;
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

</style>
