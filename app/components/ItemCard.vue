<script setup lang="ts">
import { PRIORITY_LABELS, type ItemDto } from '~~/shared/types/item'
import { describeRecurrence } from '~~/shared/utils/recurrence'
import { EDGE_WIDTH } from '~/utils/edge-swipe'

const props = defineProps<{
  item: ItemDto
  focused?: boolean
  selected?: boolean
  /** まだサーバーへ送れていない変更を抱えているか（docs/12-offline.md 12.8）。 */
  pending?: boolean
  /**
   * 状態（完了かどうか）を見た目に出さないか。
   *
   * 「すべて」を出すスマートリスト（docs/08-todo-management.md 8.6）で使う。
   * 完了・未完了を分けずに並べる見方なので、完了したものだけ取り消し線で
   * 別扱いにすると、その条件に当てはまるもの全部を眺める邪魔になる。
   */
  ignoreStatus?: boolean
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
const closed = computed(() => props.item.status === 'closed')

/** 完了したものとして**見せる**か。状態を見ない一覧では出さない。 */
const done = computed(() => !props.ignoreStatus && closed.value)

const { colorOf } = useTags()

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
  /*
   * 画面の左端から始まったものは、袖を引き出すスワイプ（useSidebarSwipe）。
   * ここでも拾うと、袖が出ながらそのタスクまで完了してしまう。
   */
  if (touch.clientX <= EDGE_WIDTH) return
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
  // 見た目に出していなくても、済んでいるものをもう一度完了にはしない
  if (dragging.value && dragX.value >= SWIPE_THRESHOLD && !closed.value) {
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
      この端末にだけある変更。オフライン中に書いたものが分かるように
      （docs/12-offline.md 12.8）。右端に小さく出すだけにして、文字にすると
      タグの位置が（未同期かどうかで）ずれてしまうため、他の要素とは
      独立に絶対配置する。
    -->
    <span
      v-if="pending"
      class="card__pending"
      title="まだサーバーへ送れていない変更があります"
    >
      <span class="sr-only">未同期</span>
    </span>

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

    <!--
      くり返し・リンク・タグは、タイトルと同じ行に続けて並べる（RTM に倣う）。
      1行に情報を集めて、一覧に入る件数を増やすため。入りきらないときだけ
      折り返す。期限は右端に寄せる。
    -->
    <div class="card__main">
      <div class="card__body">
        <button type="button" class="card__title" @click.stop="emit('open')">
          {{ item.title }}
        </button>
        <!--
          重要度は左端の色で表している（.card--priority-*）。文字では出さないが、
          色だけが手がかりになるのを避けるため、読み上げ用の名前だけ残す。
        -->
        <span v-if="item.priority" class="sr-only">
          重要度{{ PRIORITY_LABELS[item.priority] }}
        </span>
        <span v-if="recurrenceLabel" class="card__recurrence" :title="recurrenceLabel">
          <span aria-hidden="true">↻</span>
          <span class="sr-only">{{ recurrenceLabel }}</span>
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
          <span aria-hidden="true">↗</span>
        </a>
        <button
          v-for="tag in item.tags"
          :key="tag"
          type="button"
          class="card__tag"
          :style="{
            '--tag-color': tagColorVar(colorOf(tag)),
            '--tag-text': tagTextColorVar(colorOf(tag)),
          }"
          :aria-label="`タグ「${tag}」で絞り込む`"
          @click.stop="emit('filterTag', tag)"
        >
          {{ tag }}
        </button>
      </div>
      <span
        v-if="due.state !== 'none'"
        class="card__due"
        :class="`card__due--${due.state}`"
      >
        {{ due.label }}
      </span>
    </div>
  </article>
</template>

<style scoped>
/*
 * 一覧の1行（RTM に倣う）。カードとして1件ずつ浮かせず、罫線だけで区切る。
 * 影・角丸・行間の余白は、そのぶん画面に入る件数を減らすため置かない
 * （情報密度を上げる）。
 */
.card {
  position: relative;
  background: var(--surface);
  border-bottom: 1px solid var(--border);
  /* 左端は重要度の帯（::before）の場所を空ける */
  padding: 0.25rem 0.75rem 0.25rem 0.5rem;
  display: flex;
  align-items: flex-start;
  gap: 0.375rem;
  transition: transform 0.15s ease;
}

/*
 * 重要度は左端の帯で示す（docs/08-todo-management.md 8.1）。
 * 一覧を眺めたときに、読まずに優先度が分かるようにするため。
 * 重要度なしは既定の灰色のまま。
 * 色だけに頼らないよう、「重要度高」の文字は読み上げ用に残す。
 *
 * 罫線で区切るようになって行が隣り合うので、border ではなく上下を空けた
 * 帯にする。border だと隣の行とつながって1本の線に見えてしまうため。
 */
.card::before {
  content: '';
  position: absolute;
  left: 0;
  top: 0.1875rem;
  bottom: 0.1875rem;
  width: 3px;
  border-radius: 999px;
  background: var(--priority-none);
}

.card--priority-1::before {
  background: var(--priority-1);
}

.card--priority-2::before {
  background: var(--priority-2);
}

.card--priority-3::before {
  background: var(--priority-3);
}

/*
 * カーソル位置。キーボード操作の対象がどれかを、行の背景色で示す
 * （RTM に倣う）。枠線だと一覧を流し見たときに気づきにくいため。
 */
.card--focused {
  background: var(--cursor-bg);
}

.card--selected {
  background: color-mix(in srgb, var(--accent) 8%, var(--surface));
}

/* 選択中かつカーソル位置。どちらの色も埋もれないよう掛け合わせる。 */
.card--focused.card--selected {
  background: color-mix(in srgb, var(--accent) 10%, var(--cursor-bg));
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
  min-width: 1.625rem;
  min-height: 1.5rem;
  display: grid;
  place-items: center;
}

.card__select-box {
  width: 1rem;
  height: 1rem;
  border: 1.5px solid var(--border);
  border-radius: 4px;
  display: grid;
  place-items: center;
  font-size: 0.8125rem;
  line-height: 1;
  color: var(--accent);
}

.card--selected .card__select-box {
  background: var(--accent);
  border-color: var(--accent);
  color: var(--accent-text);
}

/*
 * 期限だけは折り返しの対象から外し、常に1行目の右端に置く（RTM に倣う）。
 * タイトルが長くて折り返しても、期限を探す位置が変わらないようにするため。
 */
.card__main {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: baseline;
  gap: 0.375rem;
  font-size: 0.75rem;
}

/*
 * タイトル・くり返し・リンク・タグを同じ行に並べ、入りきらないときだけ
 * 折り返す。baseline でそろえるのは、タグのピルが混じっても文字の下端が
 * 波打たないようにするため。
 *
 * 素の行として流せば折り返した語の直後にタグが続くが、タイトルはボタン
 * なので行をまたげない（1つの箱として扱われる）。そのため flex で並べ、
 * タイトルが長いときはタグを次の行へ送る。
 */
.card__body {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 0.125rem 0.375rem;
}

/*
 * タイトルは伸ばさない（flex: 1 にしない）。伸ばすと後ろのタグが右端まで
 * 飛ばされ、どのタスクのタグなのか読み取りにくくなるため。
 */
.card__title {
  min-width: 0;
  background: transparent;
  border: 0;
  padding: 0;
  text-align: left;
  font-size: 0.875rem;
  font-weight: 600;
  color: inherit;
  overflow-wrap: anywhere;
}

/* 読み上げにだけ残す。場所を取らせない */
.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
}

/*
 * この端末にだけある変更があることを示す小さな点。行の右端に絶対配置し、
 * タイトル・期限・タグなど他の要素の位置には一切影響しないようにする
 * （文字で出すと、未同期かどうかでタグの開始位置がずれてしまうため）。
 * 期限と重ならないよう、`.card` の右の余白の中に納める。
 */
.card__pending {
  position: absolute;
  top: 50%;
  right: 0.125rem;
  transform: translateY(-50%);
  width: 0.375rem;
  height: 0.375rem;
  border-radius: 50%;
  background: var(--text-muted);
}

/* 期限は右端に寄せる。行のどこに出るかを一定にして、目で追えるようにする */
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

/*
 * くり返し・リンクはアイコンだけにする（RTM に倣う）。1行に並べるようになり、
 * 文字まで出すとタイトルが押し出されるため。内容は title / aria-label に残す。
 */
.card__recurrence {
  color: var(--text-muted);
  flex-shrink: 0;
}

.card__url {
  color: var(--accent);
  text-decoration: none;
  flex-shrink: 0;
}

/*
 * RTM 風の塗りつぶしピル。タグごとの色を背景に敷き、文字色は色見本と
 * 対になっている色を使う（main.css の --tag-* / --tag-*-fg）。
 */
.card__tag {
  flex-shrink: 0;
  background: var(--tag-color);
  border: 0;
  border-radius: 999px;
  padding: 0 0.375rem;
  color: var(--tag-text);
  font-size: 0.6875rem;
  font-weight: 600;
  line-height: 1.5;
  overflow-wrap: anywhere;
}

</style>
