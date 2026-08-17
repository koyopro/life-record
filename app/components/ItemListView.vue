<script setup lang="ts">
import type { Shortcut } from '~/composables/useShortcuts'
import {
  SORT_KEYS,
  SORT_LABELS,
  type ItemDto,
  type ItemStatus,
  type SortKey,
} from '~~/shared/types/item'
import type { Recurrence } from '~~/shared/types/recurrence'

const props = defineProps<{
  status: ItemStatus | 'all'
  storageKey: string
  /** 並べ替えを操作させるか。Inbox は追加順で十分なので隠す。 */
  showSort?: boolean
  /** 絞り込むタグ名。 */
  tag?: string
  /** タグが付いていない Item だけに絞るか。 */
  untagged?: boolean
  /** 期限が今日までのものだけに絞るか（「今日」リスト）。 */
  dueUntilToday?: boolean
  /** 未完了のものだけに絞るか。 */
  openOnly?: boolean
  /** 既定のソート軸。 */
  defaultSort?: SortKey
  emptyMessage: string
}>()

const emit = defineEmits<{ filterTag: [tag: string] }>()

const list = useItemList({
  status: () => props.status,
  tag: () => props.tag,
  untagged: () => Boolean(props.untagged),
  dueUntilToday: () => Boolean(props.dueUntilToday),
  openOnly: () => Boolean(props.openOnly),
  sortStorageKey: props.storageKey,
  defaultSort:
    props.defaultSort ?? (props.status === 'inbox' ? 'created' : 'priority'),
})

const helpOpen = ref(false)
const dueOpen = ref(false)
const tagOpen = ref(false)
const tagFocusRemoval = ref(false)
const recurrenceOpen = ref(false)
const actionTarget = ref<ItemDto | null>(null)

function open(item: ItemDto) {
  navigateTo(`/items/${item.id}`)
}

/**
 * ショートカット定義（docs/08-todo-management.md 8.4）。
 * ヘルプ（`?`）はこの配列から生成する。
 */
const shortcuts = computed<Shortcut[]>(() => [
  {
    keys: ['j', 'ArrowDown'],
    display: 'j / ↓',
    label: '次のタスクへ',
    group: '移動',
    run: () => list.moveCursor(1),
  },
  {
    keys: ['k', 'ArrowUp'],
    display: 'k / ↑',
    label: '前のタスクへ',
    group: '移動',
    run: () => list.moveCursor(-1),
  },
  {
    keys: ['Enter'],
    label: '詳細を開く',
    group: '移動',
    run: () => {
      const target = list.cursorItem.value
      if (target) open(target)
    },
  },
  {
    keys: ['x'],
    label: '選択 / 選択解除',
    group: '選択',
    run: () => list.toggleSelect(),
  },
  {
    keys: ['c'],
    label: '完了にする',
    group: '編集',
    run: () => list.complete(),
  },
  {
    keys: ['d'],
    label: '期限を設定',
    group: '編集',
    run: () => {
      if (list.targets.value.length > 0) dueOpen.value = true
    },
  },
  {
    keys: ['p'],
    label: '期限を1日延ばす',
    group: '編集',
    run: () => list.postpone(),
  },
  {
    keys: ['1'],
    label: '重要度を高くする',
    group: '編集',
    run: () => list.setPriority(1),
  },
  {
    keys: ['2'],
    label: '重要度を中にする',
    group: '編集',
    run: () => list.setPriority(2),
  },
  {
    keys: ['3'],
    label: '重要度を低くする',
    group: '編集',
    run: () => list.setPriority(3),
  },
  {
    keys: ['4'],
    label: '重要度を外す',
    group: '編集',
    run: () => list.setPriority(null),
  },
  {
    keys: ['t'],
    label: 'タグを追加',
    group: '編集',
    run: () => openTags(false),
  },
  {
    keys: ['T'],
    display: 't',
    shift: true,
    label: 'タグを外す',
    group: '編集',
    run: () => openTags(true),
  },
  {
    keys: ['r'],
    label: '繰り返しを設定',
    group: '編集',
    run: () => {
      if (list.targets.value.length > 0) recurrenceOpen.value = true
    },
  },
  {
    keys: ['Delete', 'Backspace'],
    display: 'Delete',
    label: '削除',
    group: '編集',
    run: () => list.remove(),
  },
  {
    keys: ['u'],
    label: '直前の操作を取り消す',
    group: 'その他',
    run: () => list.undo(),
  },
  {
    keys: ['?', '/'],
    display: '?',
    shift: true,
    label: 'ショートカット一覧',
    group: 'その他',
    run: () => {
      helpOpen.value = true
    },
  },
  {
    keys: ['Escape'],
    display: 'Esc',
    label: 'キャンセル / 選択解除',
    group: 'その他',
    allowInInput: true,
    run: () => {
      if (
        helpOpen.value ||
        dueOpen.value ||
        tagOpen.value ||
        recurrenceOpen.value ||
        actionTarget.value
      ) {
        helpOpen.value = false
        dueOpen.value = false
        tagOpen.value = false
        recurrenceOpen.value = false
        actionTarget.value = null
        return
      }
      list.clearSelection()
      if (document.activeElement instanceof HTMLElement) {
        document.activeElement.blur()
      }
    },
  },
])

const { groups } = useShortcuts(shortcuts)

async function toggleComplete(item: ItemDto) {
  list.focusItem(item.id)
  list.clearSelection()
  await nextTick()
  if (item.status === 'closed') await list.setStatus('backlog')
  else await list.complete()
}

async function applyDue(due: { date: Date; hasTime: boolean } | null) {
  dueOpen.value = false
  await list.setDue(due?.date ?? null, due?.hasTime ?? false)
}

function openTags(focusRemoval: boolean) {
  if (list.targets.value.length === 0) return
  tagFocusRemoval.value = focusRemoval
  tagOpen.value = true
}

async function applyTags(changes: { add: string[]; remove: string[] }) {
  tagOpen.value = false
  await list.applyTags(changes.add, changes.remove)
}

/** 単一選択なら現在の設定を初期値に入れる。 */
const currentRecurrence = computed(() => {
  const targets = list.targets.value
  if (targets.length !== 1) return null
  const target = targets[0]!
  if (!target.recurrenceRule || !target.recurrenceBasis) return null
  return { rule: target.recurrenceRule, basis: target.recurrenceBasis }
})

async function applyRecurrence(recurrence: Recurrence | null) {
  recurrenceOpen.value = false
  await list.setRecurrence(recurrence)
}

async function fromSheet(action: () => Promise<void>) {
  const target = actionTarget.value
  actionTarget.value = null
  if (!target) return
  list.focusItem(target.id)
  list.clearSelection()
  await nextTick()
  await action()
}

defineExpose({ create: list.create, refresh: list.refresh })
</script>

<template>
  <div class="list">
    <div class="list__bar">
      <div class="list__status" role="status">
        <span v-if="list.selectedIds.value.size" class="list__selected">
          {{ list.selectedIds.value.size }}件を選択中
        </span>
        <span v-else-if="list.message.value">{{ list.message.value }}</span>
      </div>

      <div class="list__controls">
        <label v-if="showSort" class="list__sort">
          <span class="list__sort-label">並び</span>
          <select v-model="list.sort.value" class="list__sort-select">
            <option v-for="key in SORT_KEYS" :key="key" :value="key">
              {{ SORT_LABELS[key] }}
            </option>
          </select>
        </label>
        <button
          type="button"
          class="list__help"
          aria-label="キーボードショートカット"
          @click="helpOpen = true"
        >
          ?
        </button>
      </div>
    </div>

    <p v-if="list.errorMessage.value" class="list__error" role="alert">
      {{ list.errorMessage.value }}
    </p>
    <p v-if="list.error.value" class="list__error" role="alert">
      一覧を読み込めませんでした
    </p>

    <p
      v-else-if="list.loading.value && !list.items.value.length"
      class="list__placeholder"
    >
      読み込み中…
    </p>

    <p v-else-if="!list.items.value.length" class="list__placeholder">
      {{ emptyMessage }}
    </p>

    <ul v-else class="list__items">
      <li v-for="(item, index) in list.items.value" :key="item.id">
        <ItemCard
          :item="item"
          :focused="index === list.cursor.value"
          :selected="list.selectedIds.value.has(item.id)"
          @focus="list.cursor.value = index"
          @select="list.toggleSelect(item.id)"
          @complete="toggleComplete(item)"
          @open="open(item)"
          @longpress="actionTarget = item"
          @filter-tag="(tag) => emit('filterTag', tag)"
        />
      </li>
    </ul>

    <ShortcutHelp v-if="helpOpen" :groups="groups" @close="helpOpen = false" />

    <DueDialog
      v-if="dueOpen"
      :count="list.targets.value.length"
      @submit="applyDue"
      @close="dueOpen = false"
    />

    <RecurrenceDialog
      v-if="recurrenceOpen"
      :count="list.targets.value.length"
      :current="currentRecurrence"
      @submit="applyRecurrence"
      @close="recurrenceOpen = false"
    />

    <TagDialog
      v-if="tagOpen"
      :items="list.targets.value"
      :focus-removal="tagFocusRemoval"
      @apply="applyTags"
      @close="tagOpen = false"
    />

    <ItemActionSheet
      v-if="actionTarget"
      :item="actionTarget"
      @close="actionTarget = null"
      @complete="fromSheet(() => toggleComplete(actionTarget!))"
      @priority="(value) => fromSheet(() => list.setPriority(value))"
      @postpone="fromSheet(() => list.postpone())"
      @recurrence="
        () => {
          actionTarget && list.focusItem(actionTarget.id)
          actionTarget = null
          list.clearSelection()
          recurrenceOpen = true
        }
      "
      @tags="
        () => {
          actionTarget && list.focusItem(actionTarget.id)
          actionTarget = null
          list.clearSelection()
          openTags(false)
        }
      "
      @due="
        () => {
          actionTarget && list.focusItem(actionTarget.id)
          actionTarget = null
          list.clearSelection()
          dueOpen = true
        }
      "
      @open="open(actionTarget)"
      @remove="fromSheet(() => list.remove())"
    />
  </div>
</template>

<style scoped>
.list {
  display: grid;
  gap: 0.625rem;
}

.list__bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  min-height: 2rem;
}

.list__status {
  color: var(--text-muted);
  font-size: 0.8125rem;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.list__selected {
  color: var(--accent);
  font-weight: 600;
}

.list__controls {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  flex-shrink: 0;
}

.list__sort {
  display: flex;
  align-items: center;
  gap: 0.375rem;
}

.list__sort-label {
  color: var(--text-muted);
  font-size: 0.8125rem;
}

.list__sort-select {
  font: inherit;
  font-size: 0.875rem;
  background: var(--surface);
  color: var(--text);
  border: 1px solid var(--border);
  border-radius: 8px;
  min-height: 2.25rem;
  padding: 0 0.5rem;
}

.list__help {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 8px;
  color: var(--text-muted);
  width: 2.25rem;
  height: 2.25rem;
}

/* キーボードが使えない端末ではヘルプを出す意味が薄い */
@media (hover: none) {
  .list__help {
    display: none;
  }
}

.list__items {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: 0.5rem;
  /* スワイプ時にカードが横へずれても見切れないようにする */
  overflow-x: clip;
}

.list__placeholder {
  margin: 0;
  color: var(--text-muted);
  text-align: center;
  padding: 2rem 0;
}

.list__error {
  margin: 0;
  color: var(--danger);
  font-size: 0.875rem;
}
</style>
