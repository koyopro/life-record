<script setup lang="ts">
import type { Shortcut } from '~/composables/useShortcuts'
import {
  GROUP_KEYS,
  GROUP_LABELS,
  SORT_KEYS,
  SORT_LABELS,
  type ItemDto,
  type ItemStatus,
  type SortKey,
  isOpenableUrl,
} from '~~/shared/types/item'
import { groupItems } from '~/utils/item-order'
import type { Recurrence } from '~~/shared/types/recurrence'
import { normalizeTagName } from '~~/shared/types/tag'

const props = withDefaults(
  defineProps<{
    status: ItemStatus | 'all'
    storageKey: string
    /** 並べ替えを操作させるか。 */
    showSort?: boolean
    /** タグの絞り込みバーを出すか。 */
    showTagFilter?: boolean
    /**
     * 指定すると、未完了/完了・並び・ヘルプボタンの行（list__bar）を
     * ここへ描画する（テレポート）。呼び出し側の header に含め、
     * 一覧の表示エリアを押し下げないようにするため。
     * CSS セレクタで渡す（SSR でも解決できるように）。
     */
    barTarget?: string
    /** 期限が今日までのものだけに絞るか（「今日」リスト）。 */
    dueUntilToday?: boolean
    /** 未完了のものだけに絞るか。 */
    openOnly?: boolean
    /** 既定のソート軸。 */
    defaultSort?: SortKey
    emptyMessage: string
  }>(),
  { showTagFilter: true },
)

const route = useRoute()
const router = useRouter()

// --- タグでの絞り込み（docs/09-tags.md 9.3） -----------------------------
//
// どの一覧でも同じように使えるよう、ここで持つ。
// 状態は URL に置き、再読み込みや共有で同じ絞り込みに戻せるようにする。

const { tags: allTags } = useTags()

const tag = computed<string | undefined>(() => {
  const value = route.query.tag
  if (typeof value !== 'string') return undefined
  return normalizeTagName(value) ?? undefined
})

const untagged = computed(() => route.query.untagged === 'true')

// --- 完了済みの表示（`h`） -----------------------------------------------
//
// RTM の「未完了 / 完了」の切り替えと同じ。いまの絞り込み（タグ・期限）は
// そのままに、完了したものだけを出す。状態は URL に残す。
//
// 両側とも useItemList があらかじめ取っておくので、切り替えは待たされない。

const completed = computed(() => route.query.completed === 'true')

const list = useItemList({
  status: () => props.status,
  completed: () => completed.value,
  tag: () => tag.value,
  untagged: () => untagged.value,
  dueUntilToday: () => Boolean(props.dueUntilToday),
  openOnly: () => Boolean(props.openOnly),
  sortStorageKey: props.storageKey,
  defaultSort: props.defaultSort ?? 'priority',
})

/**
 * グループ順（並びより上位の区切り、RTM の Group by）。並び替え済みの
 * `list.items` を、選んでいる軸で見出し付きの塊に分けるだけで、
 * 各グループの中の順序は並びのまま変えない。
 */
const groupedItems = computed(() => groupItems(list.items.value, list.groupBy.value))

const helpOpen = ref(false)
const dueOpen = ref(false)
const tagOpen = ref(false)
const tagFocusRemoval = ref(false)
const recurrenceOpen = ref(false)
const actionTarget = ref<ItemDto | null>(null)

// --- 分割表示（docs/03-functional-spec.md 3.1） ---------------------------
//
// 画面が広ければ、一覧を左に残したまま右側に詳細を出す。
// すべての一覧で同じ挙動にしたいので、ここに置いて共通化する。

const split = useSplitLayout()

/**
 * カーソルが動いたら、その行が見えるところまでスクロールする。
 *
 * `j` / `k` で送っていると画面外へ出てしまい、どこを操作しているのか
 * 分からなくなるため。すでに見えているときは動かさない。
 */
const listEl = ref<HTMLElement | null>(null)

watch(
  () => list.cursorItem.value?.id,
  async (id) => {
    if (!id) return
    await nextTick()
    listEl.value
      ?.querySelector(`[data-item-id="${id}"]`)
      ?.scrollIntoView({ block: 'nearest' })
  },
)

/**
 * カーソル以外から明示的に選んだ Item。
 *
 * 系列の過去オカレンスなど、いま表示している一覧に含まれないものを
 * 出す場合があるため、カーソルとは別に持つ。
 */
const pinnedId = ref<string | null>(
  typeof route.query.selected === 'string' ? route.query.selected : null,
)

const selectedId = computed(() =>
  split.value ? (pinnedId.value ?? list.cursorItem.value?.id ?? null) : null,
)

// カーソルが実際に動いたら、明示的な選択は解除してカーソルに追従させる。
// 再取得のたびに解除すると、編集の直後に別のタスクへ飛んでしまう。
watch(
  () => list.cursorItem.value?.id,
  (id, previous) => {
    if (id && previous && id !== previous) pinnedId.value = null
  },
)

// 選択を URL に残す。再読み込みや共有で同じ状態に戻せるようにする。
// 履歴を汚さないよう replace を使う。
watch(selectedId, (id) => {
  const next = id ?? undefined
  if (route.query.selected === next) return
  const query = { ...route.query, selected: next }
  if (!next) delete query.selected
  router.replace({ query })
})

/**
 * 詳細を開く。広い画面では右ペインに出し、狭い画面では詳細画面へ遷移する。
 *
 * カーソルも合わせる。合わせないと、右ペインに出したものと
 * キーボード操作の対象がずれる。
 */
function open(item: ItemDto) {
  list.focusItem(item.id)
  if (split.value) {
    pinnedId.value = item.id
    return
  }
  navigateTo(`/items/${item.id}`)
}

interface DetailExposed {
  focusTitle: () => void
  focusUrl: () => void
  focusBody: () => void
  focusTodaySection: () => void
}

const detail = ref<DetailExposed | null>(null)

/**
 * 詳細の指定した欄へフォーカスする（`r` / `u` / `y`）。
 *
 * 右ペインが出ていればその欄へ。出ていない狭い画面では、
 * 編集できる場所が詳細画面しかないのでそちらへ移動する。
 */
async function focusDetail(field: 'Title' | 'Url' | 'Body' | 'TodaySection') {
  const target = list.cursorItem.value
  if (!target) return

  if (!split.value) {
    await navigateTo(`/items/${target.id}`)
    return
  }

  pinnedId.value = target.id
  await nextTick()
  detail.value?.[`focus${field}`]()
}

/**
 * タスクの URL を別タブで開く（`Shift` + `u`）。
 *
 * 開けるのは http(s) のみ。保存時にも同じ条件で弾いている。
 */
function openUrl() {
  const target = list.cursorItem.value
  if (!target) return

  if (!target.url || !isOpenableUrl(target.url)) {
    list.message.value = 'このタスクに URL はありません'
    return
  }
  window.open(target.url, '_blank', 'noopener,noreferrer')
}

function onDetailRemoved(id: string) {
  if (pinnedId.value === id) pinnedId.value = null
  // 詳細側の削除も裏で送られる。取り直しはその後ろに並べる
  void enqueue(() => list.refresh())
}

/** 右ペインで系列の別オカレンスを選んだとき。一覧にあればカーソルも合わせる。 */
function onSelectSeries(id: string) {
  pinnedId.value = id
  list.focusItem(id)
}

function setFilter(patch: { tag?: string; untagged?: string; completed?: string }) {
  const query: Record<string, unknown> = { ...route.query, ...patch }
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined) delete query[key]
  }
  // 絞り込みが変われば一覧の中身も変わるので、選択は持ち越さない
  delete query.selected
  pinnedId.value = null
  router.replace({ query: query as Record<string, string> })
}

/** 同じタグをもう一度押したら解除する。 */
function selectTag(name: string) {
  setFilter({
    tag: tag.value === name ? undefined : name,
    untagged: undefined,
  })
}

function toggleUntagged() {
  setFilter({
    untagged: untagged.value ? undefined : 'true',
    tag: undefined,
  })
}

/** 未完了 / 完了 を切り替える（`h`）。 */
function showCompleted(value: boolean) {
  if (value === completed.value) return
  setFilter({ completed: value ? 'true' : undefined })
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
    keys: ['o', 'Enter'],
    display: 'o',
    label: 'タスクを開く',
    group: '移動',
    run: () => {
      const target = list.cursorItem.value
      if (target) open(target)
    },
  },
  {
    keys: ['h'],
    label: '完了 / 未完了を切り替え',
    group: '移動',
    run: () => showCompleted(!completed.value),
  },
  {
    keys: ['i'],
    label: 'タスクを選択',
    group: '選択',
    run: () => list.toggleSelect(),
  },
  {
    prefix: '*',
    keys: ['a'],
    label: '全タスクを選択',
    group: '選択',
    run: () => list.selectAll(),
  },
  {
    prefix: '*',
    keys: ['n'],
    label: 'すべてのタスクの選択を解除',
    group: '選択',
    run: () => list.clearSelection(),
  },
  {
    prefix: '*',
    keys: ['t'],
    label: '期限が今日のタスクを選択',
    group: '選択',
    run: () => list.selectByDue('today'),
  },
  {
    prefix: '*',
    keys: ['o'],
    label: '期限が明日のタスクを選択',
    group: '選択',
    run: () => list.selectByDue('tomorrow'),
  },
  {
    prefix: '*',
    keys: ['v'],
    label: '期限切れのタスクを選択',
    group: '選択',
    run: () => list.selectByDue('overdue'),
  },
  {
    // 完了側を見ているときは戻す操作のほうが要る。RTM も同じキーで両方を担う
    keys: ['c'],
    label: completed.value ? '未完了に戻す' : '完了にする',
    group: '編集',
    run: () => (completed.value ? list.setStatus('backlog') : list.complete()),
  },
  {
    keys: ['b'],
    label: '未着手にする',
    group: '編集',
    run: () => list.setStatus('backlog'),
  },
  {
    keys: ['w'],
    label: '対応中にする',
    group: '編集',
    run: () => list.setStatus('in_progress'),
  },
  {
    keys: ['d'],
    label: '期日を変更',
    group: '編集',
    run: () => {
      if (list.targets.value.length > 0) dueOpen.value = true
    },
  },
  {
    keys: ['p', 'P'],
    display: 'p',
    label: '延期（明日にする）',
    group: '編集',
    run: () => list.postpone(),
  },
  {
    keys: ['1'],
    label: '優先度を1に設定',
    group: '編集',
    run: () => list.setPriority(1),
  },
  {
    keys: ['2'],
    label: '優先度を2に設定',
    group: '編集',
    run: () => list.setPriority(2),
  },
  {
    keys: ['3'],
    label: '優先度を3に設定',
    group: '編集',
    run: () => list.setPriority(3),
  },
  {
    keys: ['4'],
    label: '優先度を設定しない',
    group: '編集',
    run: () => list.setPriority(null),
  },
  {
    keys: ['s'],
    label: 'タグを変更',
    group: '編集',
    run: () => openTags(false),
  },
  {
    keys: ['r'],
    label: '名称を変更',
    group: '編集',
    run: () => focusDetail('Title'),
  },
  {
    keys: ['u'],
    label: 'URL を変更',
    group: '編集',
    run: () => focusDetail('Url'),
  },
  {
    keys: ['y'],
    label: 'ノートを追加（本文）',
    group: '編集',
    run: () => focusDetail('Body'),
  },
  {
    keys: ['Y'],
    display: 'y',
    shift: true,
    label: '今日の作業記録を書く',
    group: '編集',
    run: () => focusDetail('TodaySection'),
  },
  {
    keys: ['U'],
    display: 'u',
    shift: true,
    label: 'URL を開く',
    group: 'その他',
    run: () => openUrl(),
  },
  {
    keys: ['f'],
    label: 'くり返し設定を変更',
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
    keys: ['z'],
    label: '元に戻す',
    group: 'その他',
    run: () => list.undo(),
  },
  {
    keys: ['/'],
    label: '検索',
    group: 'その他',
    run: () => navigateTo('/search'),
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

/** 対象に付いているタグ（複数選択時は和集合）。 */
const targetTags = computed(() =>
  list.targets.value.flatMap((item) => item.tags),
)

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

defineExpose({
  create: list.create,
  refresh: list.refresh,
  focusItem: list.focusItem,
})
</script>

<template>
  <div class="split" :class="{ 'split--active': selectedId }">
    <div class="list">
      <nav v-if="showTagFilter && allTags.length" class="tags" aria-label="タグで絞り込む">
        <button
          type="button"
          class="tags__item"
          :class="{ 'tags__item--active': untagged }"
          :aria-pressed="untagged"
          @click="toggleUntagged"
        >
          タグなし
        </button>
        <button
          v-for="entry in allTags"
          :key="entry.id"
          type="button"
          class="tags__item"
          :class="{ 'tags__item--active': tag === entry.name }"
          :aria-pressed="tag === entry.name"
          @click="selectTag(entry.name)"
        >
          #{{ entry.name }}
          <span class="tags__count">{{ entry.count }}</span>
        </button>
      </nav>

      <Teleport :disabled="!barTarget" :to="barTarget || 'body'">
        <div class="list__bar">
          <!-- キーボードを使わなくても切り替えられるようにする（`h` と同じ） -->
          <div class="list__view" role="group" aria-label="完了 / 未完了">
            <button
              type="button"
              class="list__view-item"
              :class="{ 'list__view-item--active': !completed }"
              :aria-pressed="!completed"
              @click="showCompleted(false)"
            >
              未完了
            </button>
            <button
              type="button"
              class="list__view-item"
              :class="{ 'list__view-item--active': completed }"
              :aria-pressed="completed"
              @click="showCompleted(true)"
            >
              完了
            </button>
          </div>

          <div class="list__status" role="status">
            <span v-if="list.selectedIds.value.size" class="list__selected">
              {{ list.selectedIds.value.size }}件を選択中
            </span>
            <span v-else-if="list.message.value">{{ list.message.value }}</span>
          </div>

          <div class="list__controls">
            <label v-if="showSort" class="list__sort">
              <span class="list__sort-label">グループ</span>
              <select v-model="list.groupBy.value" class="list__sort-select">
                <option v-for="key in GROUP_KEYS" :key="key" :value="key">
                  {{ GROUP_LABELS[key] }}
                </option>
              </select>
            </label>
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
      </Teleport>

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
        {{ completed ? '完了したタスクはありません。' : emptyMessage }}
      </p>

      <div v-else ref="listEl" class="list__groups">
        <section v-for="group in groupedItems" :key="group.key" class="list__group">
          <h2 v-if="group.label" class="list__group-title">{{ group.label }}</h2>
          <ul class="list__items">
            <li
              v-for="{ item, index } in group.items"
              :key="item.id"
              :data-item-id="item.id"
            >
              <ItemCard
                :item="item"
                :focused="index === list.cursor.value"
                :selected="list.selectedIds.value.has(item.id)"
                :pending="item.syncState !== 'synced'"
                @focus="list.focusItem(item.id)"
                @select="list.toggleSelect(item.id)"
                @complete="toggleComplete(item)"
                @open="open(item)"
                @longpress="actionTarget = item"
                @filter-tag="selectTag"
              />
            </li>
          </ul>
        </section>
      </div>
    </div>

    <aside v-if="selectedId" class="split__detail">
      <!-- id が変わったら作り直す。前のタスクの編集状態を持ち越さないため -->
      <ItemDetail
        :key="selectedId"
        ref="detail"
        :item-id="selectedId"
        embedded
        @removed="onDetailRemoved"
        @changed="list.refresh()"
        @select-series="onSelectSeries"
      />
    </aside>

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
      :tags="targetTags"
      :count="list.targets.value.length"
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
/*
 * 一覧と詳細の分割。詳細が出ていないときは、読みやすい幅に収める。
 * すべての一覧で同じ挙動にするため、ここで完結させる。
 */
.split {
  display: grid;
  gap: 1.5rem;
  max-width: 40rem;
}

@media (min-width: 60rem) {
  .split--active {
    max-width: none;
    grid-template-columns: minmax(0, 22rem) minmax(0, 1fr);
    align-items: start;
  }

  /* 詳細は別スクロール。長い本文を読んでも一覧の位置が動かない */
  .split--active .split__detail {
    position: sticky;
    top: 1rem;
    max-height: calc(100vh - 2rem);
    overflow-y: auto;
    padding-right: 0.25rem;
  }
}

.split__detail {
  min-width: 0;
  border-left: 1px solid var(--border);
  padding-left: 1.5rem;
}

.list {
  min-width: 0;
  display: grid;
  /*
   * 列は必ず親の幅に収める。既定（auto）だと、中身のいちばん広いもの
   * （並び替えのセレクトなど）の最小幅まで列が広がり、分割表示で
   * 一覧が詳細に重なる。はみ出させず、中身のほうを折り返させる。
   */
  grid-template-columns: minmax(0, 1fr);
  gap: 0.625rem;
}

.tags {
  display: flex;
  gap: 0.25rem;
  overflow-x: auto;
  /* 横スクロールはしてよいが、スクロールバーは出さない */
  scrollbar-width: none;
}

.tags::-webkit-scrollbar {
  display: none;
}

.tags__item {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
  background: transparent;
  border: 0;
  color: var(--text-muted);
  min-height: 2.25rem;
  padding: 0 0.375rem;
  white-space: nowrap;
  font-size: 0.8125rem;
}

.tags__item--active {
  color: var(--accent);
  font-weight: 600;
}

.tags__count {
  font-size: 0.6875rem;
  font-variant-numeric: tabular-nums;
  opacity: 0.7;
}

.list__bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  /* 一覧が狭いとき（分割表示の左側）は、操作を次の行へ送る */
  flex-wrap: wrap;
  gap: 0.5rem 0.75rem;
  min-width: 0;
  min-height: 2rem;
}

.list__status {
  color: var(--text-muted);
  font-size: 0.8125rem;
  /* 左の切り替えと右の並び替えのあいだを埋める */
  flex: 1 1 auto;
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
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 0.5rem;
  min-width: 0;
}

/* 未完了 / 完了。いま何を見ているかが一目で分かるよう、両方を出す */
.list__view {
  display: flex;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 8px;
  overflow: hidden;
}

.list__view-item {
  background: transparent;
  border: 0;
  color: var(--text-muted);
  min-height: 2.25rem;
  padding: 0 0.625rem;
  font-size: 0.8125rem;
  white-space: nowrap;
}

.list__view-item--active {
  background: color-mix(in srgb, var(--accent) 14%, transparent);
  color: var(--accent);
  font-weight: 600;
}

.list__sort {
  display: flex;
  align-items: center;
  gap: 0.375rem;
  min-width: 0;
}

.list__sort-label {
  color: var(--text-muted);
  font-size: 0.8125rem;
}

.list__sort-select {
  font: inherit;
  font-size: 0.875rem;
  /* 選択肢の文字数ぶんの幅を要求させない。狭いときは縮める */
  min-width: 0;
  max-width: 100%;
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

/*
 * グループ順（RTM の Group by）。見出しが無い（グループ順「なし」）ときは
 * 1つの塊だけになるので、これまでの単一の一覧と見た目が変わらないように、
 * 余白は見出しの有無に関わらず .list__group 側にまとめる。
 */
.list__groups {
  display: grid;
  gap: 1rem;
}

.list__group-title {
  margin: 0 0 0.375rem;
  font-size: 0.875rem;
  font-weight: 600;
  color: var(--text-muted);
}

/*
 * 行の間は空けず、罫線だけで区切る（RTM に倣う）。1画面に入る件数を
 * 増やすため。行どうしの区切りは各行の下線（ItemCard.vue の .card）が
 * 引くので、ここでは一覧の上端だけ閉じる。
 */
.list__items {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  border-top: 1px solid var(--border);
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
