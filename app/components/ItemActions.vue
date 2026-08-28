<script setup lang="ts">
import type { ItemList } from '~/composables/useItemList'
import type { Shortcut } from '~/composables/useShortcuts'
import type { ItemDto } from '~~/shared/types/item'
import type { Recurrence } from '~~/shared/types/recurrence'
import { describeUrlOpen, openableUrls } from '~/utils/item-url'
import { hasTextSelection } from '~/utils/keyboard-surface'

/**
 * タスクに対する操作（docs/08-todo-management.md 8.4）。
 *
 * キーボードのショートカット・操作シート・チェックした分の帯・各ダイアログを
 * まとめて持つ。**一覧でも検索結果でも同じことができる**ようにするため、
 * 画面ごとに書き分けず、`useItemList` を渡せばそのまま付く形にする。
 *
 * 一覧の中の移動（`j` / `k` / `o`）は持たない。何を1本の並びとして送るかは
 * 画面ごとに違う（検索結果にはタスク以外の行も混ざる）ので、そちらは
 * 呼ぶ側が `useListCursor` で持つ。
 */
const props = defineProps<{
  /** 操作の相手。対象（カーソル／チェック）はこの中にある。 */
  list: ItemList
  /** 完了側を見ているか。操作の向き（完了にする / 戻す）を決める。 */
  completed: boolean
  /** 「未完了 / 完了」を切り替えられるか（`h`）。 */
  switchable?: boolean
  /** タスクを開く（広い画面なら右ペイン、狭ければ詳細画面）。 */
  open: (item: ItemDto) => void
  /** 詳細の欄へ移る（`r` / `u` / `y` / `m`）。 */
  focusDetail: (field: 'Title' | 'Url' | 'Body' | 'Note') => void | Promise<void>
}>()

const emit = defineEmits<{
  /** `h` で切り替えた。URL に残すのは呼ぶ側（残し方が画面ごとに違う）。 */
  'update:completed': [value: boolean]
}>()

const list = computed(() => props.list)

const helpOpen = ref(false)
const dueOpen = ref(false)
const tagOpen = ref(false)
const tagFocusRemoval = ref(false)
const recurrenceOpen = ref(false)

/**
 * 操作シート（ItemActionSheet）を開いている対象。
 *
 * 長押しは触れたその1件、チェックからはチェックしたもの全部が対象。
 * どちらも同じシートを出すが、対象の決め方だけが違う。
 */
const sheetFor = ref<
  { mode: 'longpress'; item: ItemDto } | { mode: 'selection' } | null
>(null)

/**
 * タスクの URL を別タブで開く（`Shift` + `u`）。
 *
 * チェックしたタスクがあれば**その全部**を新しいタブで開く（他の操作と同じく
 * 選択中の全件が対象）。チェックが無ければカーソルのタスク1件。開けるのは
 * http(s) のみで、保存時にも同じ条件で弾いている。
 *
 * 開くのは押した打鍵の流れの中で行う。待ってから開くと、利用者の操作から
 * 離れた開き方になり、ブラウザにポップアップとして止められる。
 */
function openUrl() {
  const targets = list.value.targets.value
  if (targets.length === 0) return

  const found = openableUrls(targets)
  for (const url of found.urls) window.open(url, '_blank', 'noopener,noreferrer')

  list.value.message.value = describeUrlOpen(found)
}

/**
 * カーソルのタスクを、そのタスクだけのページで開く（`Shift`+`o`）。
 *
 * 分割表示（PC）の `o` は右ペインに出すだけなので、URL をそのまま渡したい
 * ときや広い幅で読み書きしたいときの行き先を別に用意する。狭い画面では
 * `o` と同じ行き先になる。
 *
 * 対象はカーソルの1件だけ。チェックした分を見ないのは、移れる先が1つしか
 * ないため（`Shift`+`u` のようにタブを並べて開くのとは違う）。
 */
function openPage() {
  const target = list.value.cursorItem.value
  if (!target) return
  void navigateTo(`/items/${target.id}`)
}

/** 未完了 / 完了 を切り替える（`h`）。固定されている一覧では何もしない。 */
function showCompleted(value: boolean) {
  if (!props.switchable || value === props.completed) return
  emit('update:completed', value)
}

const shortcuts = computed<Shortcut[]>(() => [
  ...(props.switchable
    ? [
        {
          keys: ['h'],
          label: '完了 / 未完了を切り替え',
          group: '移動',
          run: () => showCompleted(!props.completed),
        } satisfies Shortcut,
      ]
    : []),
  {
    keys: ['O'],
    shift: true,
    label: 'タスクを単体のページで開く',
    group: '移動',
    run: () => openPage(),
  },
  {
    keys: ['i'],
    label: 'タスクを選択',
    group: '選択',
    run: () => list.value.toggleSelect(),
  },
  {
    prefix: '*',
    keys: ['a'],
    label: '全タスクを選択',
    group: '選択',
    run: () => list.value.selectAll(),
  },
  {
    prefix: '*',
    keys: ['n'],
    label: 'すべてのタスクの選択を解除',
    group: '選択',
    run: () => list.value.clearSelection(),
  },
  {
    prefix: '*',
    keys: ['t'],
    label: '期限が今日のタスクを選択',
    group: '選択',
    run: () => list.value.selectByDue('today'),
  },
  {
    prefix: '*',
    keys: ['o'],
    label: '期限が明日のタスクを選択',
    group: '選択',
    run: () => list.value.selectByDue('tomorrow'),
  },
  {
    prefix: '*',
    keys: ['v'],
    label: '期限切れのタスクを選択',
    group: '選択',
    run: () => list.value.selectByDue('overdue'),
  },
  {
    // 完了側を見ているときは戻す操作のほうが要る。RTM も同じキーで両方を担う
    keys: ['c'],
    label: props.completed ? '未完了に戻す' : '完了にする',
    group: '編集',
    run: () =>
      props.completed ? list.value.setStatus('backlog') : list.value.complete(),
  },
  {
    keys: ['b'],
    label: '未着手にする',
    group: '編集',
    run: () => list.value.setStatus('backlog'),
  },
  {
    keys: ['w'],
    label: '対応中にする',
    group: '編集',
    run: () => list.value.setStatus('in_progress'),
  },
  {
    keys: ['d'],
    label: '期日を変更',
    group: '編集',
    run: () => {
      if (list.value.targets.value.length > 0) dueOpen.value = true
    },
  },
  {
    keys: ['p', 'P'],
    display: 'p',
    label: '延期（明日にする）',
    group: '編集',
    run: () => list.value.postpone(),
  },
  {
    keys: ['1'],
    label: '優先度を1に設定',
    group: '編集',
    run: () => list.value.setPriority(1),
  },
  {
    keys: ['2'],
    label: '優先度を2に設定',
    group: '編集',
    run: () => list.value.setPriority(2),
  },
  {
    keys: ['3'],
    label: '優先度を3に設定',
    group: '編集',
    run: () => list.value.setPriority(3),
  },
  {
    keys: ['4'],
    label: '優先度を設定しない',
    group: '編集',
    run: () => list.value.setPriority(null),
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
    run: () => props.focusDetail('Title'),
  },
  {
    keys: ['u'],
    label: 'URL を変更',
    group: '編集',
    run: () => props.focusDetail('Url'),
  },
  {
    keys: ['y'],
    label: '今日の作業記録を書く',
    group: '編集',
    run: () => props.focusDetail('Body'),
  },
  {
    /*
     * メモ（日付を持たない覚え書き）。作業記録と違って日記には出ず、
     * 繰り返しの次回オカレンスへ引き継がれる（docs/02-data-model.md 2.3）。
     */
    keys: ['m'],
    label: 'メモを書く',
    group: '編集',
    run: () => props.focusDetail('Note'),
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
      if (list.value.targets.value.length > 0) recurrenceOpen.value = true
    },
  },
  {
    keys: ['Delete', 'Backspace'],
    display: 'Delete',
    label: '削除',
    group: '編集',
    run: () => list.value.remove(),
  },
  {
    /*
     * 写すのは標準のコピーと同じ打鍵にする（小文字の `c` は完了）。
     * ただし文字を選んでいるなら、その選択を写したいはずなのでブラウザに譲る。
     */
    keys: ['c'],
    display: 'C',
    meta: true,
    label: 'タイトルと本文をコピー',
    group: 'その他',
    yieldToBrowser: hasTextSelection,
    run: () => list.value.copy(),
  },
  {
    keys: ['z'],
    label: '元に戻す',
    group: 'その他',
    run: () => list.value.undo(),
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
        sheetFor.value
      ) {
        helpOpen.value = false
        dueOpen.value = false
        tagOpen.value = false
        recurrenceOpen.value = false
        sheetFor.value = null
        return
      }
      list.value.clearSelection()
      if (document.activeElement instanceof HTMLElement) {
        document.activeElement.blur()
      }
    },
  },
])

const { groups } = useShortcuts(shortcuts)

/** 右スワイプ（`ItemCard`）。触れた1件だけを完了にする（戻す）。 */
async function toggleComplete(item: ItemDto) {
  list.value.focusItem(item.id)
  list.value.clearSelection()
  await nextTick()
  if (item.status === 'closed') await list.value.setStatus('backlog')
  else await list.value.complete()
}

/** 長押し（`ItemCard`）。触れた1件を対象に操作シートを開く。 */
function openSheet(item: ItemDto) {
  sheetFor.value = { mode: 'longpress', item }
}

async function applyDue(due: { date: Date; hasTime: boolean } | null) {
  dueOpen.value = false
  await list.value.setDue(due?.date ?? null, due?.hasTime ?? false)
}

function openTags(focusRemoval: boolean) {
  if (list.value.targets.value.length === 0) return
  tagFocusRemoval.value = focusRemoval
  tagOpen.value = true
}

/** 対象に付いているタグ（複数選択時は和集合）。 */
const targetTags = computed(() =>
  list.value.targets.value.flatMap((item) => item.tags),
)

async function applyTags(changes: { add: string[]; remove: string[] }) {
  tagOpen.value = false
  await list.value.applyTags(changes.add, changes.remove)
}

/** 単一選択なら現在の設定を初期値に入れる。 */
const currentRecurrence = computed<Recurrence | null>(() => {
  const targets = list.value.targets.value
  if (targets.length !== 1) return null
  const target = targets[0]!
  if (!target.recurrenceRule || !target.recurrenceBasis) return null
  return { rule: target.recurrenceRule, basis: target.recurrenceBasis }
})

async function applyRecurrence(recurrence: Recurrence | null) {
  recurrenceOpen.value = false
  await list.value.setRecurrence(recurrence)
}

/** 操作シートの対象。 */
const sheetItems = computed<ItemDto[]>(() => {
  const opened = sheetFor.value
  if (!opened) return []
  return opened.mode === 'longpress' ? [opened.item] : list.value.targets.value
})

/**
 * 操作シートから実行する。
 *
 * 長押しは触れた1件だけが対象なので、チェックを解いてカーソルを合わせてから
 * 実行する（操作は list.targets を見るため）。チェックからのときは、それが
 * そのまま対象なので何も動かさない。
 */
async function fromSheet(action: () => unknown) {
  const opened = sheetFor.value
  sheetFor.value = null
  if (!opened) return

  if (opened.mode === 'longpress') {
    list.value.focusItem(opened.item.id)
    list.value.clearSelection()
    await nextTick()
  }
  await action()
}

/**
 * 詳細を開く（シートに出るのは1件のときだけ）。
 *
 * 対象はシートを閉じる前に控える。閉じると sheetItems は空になる。
 */
function openFromSheet() {
  const target = sheetItems.value[0]
  return fromSheet(() => target && props.open(target))
}

/** チェックしたタスクをまとめて完了にする（完了側を見ているときは戻す）。 */
function completeSelection() {
  return props.completed ? list.value.setStatus('backlog') : list.value.complete()
}

/*
 * 選択中は下端に操作の帯（SelectionBar）が出る。同じ場所にある「＋」
 * （app.vue）と重ならないよう、選んでいる件数を知らせる。
 */
const selectionCount = useSelectionCount()

watchEffect(() => {
  selectionCount.value = list.value.selectedIds.value.size
})

// 画面を離れたら帯も消える。「＋」を隠したままにしない
onUnmounted(() => {
  selectionCount.value = 0
})

/** ヘルプを開く（`?` と同じ入口。一覧の「?」ボタンから呼ぶ）。 */
function showHelp() {
  helpOpen.value = true
}

defineExpose({ toggleComplete, openSheet, showHelp })
</script>

<template>
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
    v-if="sheetFor"
    :items="sheetItems"
    @close="sheetFor = null"
    @status="(value) => fromSheet(() => list.setStatus(value))"
    @priority="(value) => fromSheet(() => list.setPriority(value))"
    @postpone="fromSheet(() => list.postpone())"
    @due="fromSheet(() => (dueOpen = true))"
    @tags="fromSheet(() => openTags(false))"
    @recurrence="fromSheet(() => (recurrenceOpen = true))"
    @open="openFromSheet"
    @remove="fromSheet(() => list.remove())"
  />

  <!--
    チェックしたタスクをまとめて操作する帯。1件も選んでいなければ描かない
    （docs/08-todo-management.md 8.4）。
  -->
  <SelectionBar
    v-if="list.selectedIds.value.size"
    :count="list.selectedIds.value.size"
    :complete-label="completed ? '未完了に戻す' : '完了'"
    @complete="completeSelection"
    @due="dueOpen = true"
    @tags="openTags(false)"
    @more="sheetFor = { mode: 'selection' }"
    @clear="list.clearSelection()"
  />
</template>
