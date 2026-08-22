<script setup lang="ts">
import type { SaveDotState } from '~/components/SaveDot.vue'
import type { Shortcut } from '~/composables/useShortcuts'
import {
  ITEM_STATUSES,
  PRIORITIES,
  PRIORITY_LABELS,
  STATUS_LABELS,
  type ItemDetailDto,
  type ItemDto,
  type ItemPatch,
  type ItemStatus,
  type Priority,
  type SectionDto,
  isOpenableUrl,
} from '~~/shared/types/item'
import type { Recurrence } from '~~/shared/types/recurrence'
import { describeRecurrence } from '~~/shared/utils/recurrence'
import { formatAppDate } from '~~/shared/utils/date'

const props = defineProps<{
  itemId: string
  /**
   * 一覧の右側に並べて表示しているか。
   * 分割表示では「一覧へ」戻るリンクが不要になる。
   */
  embedded?: boolean
}>()

const emit = defineEmits<{
  /** 削除された。分割表示では親が選択を解除する。 */
  removed: [id: string]
  /** タイトルなどが変わった。親が一覧を取り直すために使う。 */
  changed: []
  /** 分割表示で、系列の別オカレンスを選び直した。 */
  selectSeries: [id: string]
}>()

const id = computed(() => props.itemId)

/** 「← 一覧へ」の戻り先。直前に見ていた一覧へ返す。 */
const listOrigin = useListOrigin()

const store = useItemStore()
const { online } = useOnline()
const { colorOf } = useTags()

const detailStore = useItemDetailStore()

/**
 * 「今日」。開いたまま日付をまたいだら切り替わる（useToday）。
 * 作業記録は当日の枠に書き込むので、これが画面の状態になる。
 */
const today = useToday()

// 分割表示では itemId が切り替わるので、top-level await は使わない
// （Suspense で一覧ごと再描画されてしまうため）。
const { error: detailError } = detailStore.track(id)

/**
 * 本文・作業記録（Section）は Item のメタデータと違い IndexedDB に無いため、
 * 読むのはストアの控えだけにする。サーバーから取った内容も、書いた内容も
 * そこへ入るので、書いてから別の Item へ切り替えて戻っても編集前の本文は
 * 出ない（docs/15-client-state.md）。
 */
const cachedDetail = computed(() => detailStore.byId(id.value))

/** ローカル（IndexedDB）にある Item。オフラインでもこちらは読める。 */
const cached = computed(() => store.byId(id.value))

/**
 * 画面に出す内容。
 *
 * メタデータはローカルを正とする（未送信の変更もここに入っている）。
 * 作業記録（Section）はサーバーにしか無いので、取れているときだけ出す
 * （docs/12-offline.md 12.9）。
 */
const item = computed<ItemDetailDto | null>(() => {
  const local = cached.value
  const fetched = cachedDetail.value

  if (!fetched) {
    if (!local) return null
    return { ...local, sections: [], primarySectionId: null }
  }
  if (!local) return fetched

  return {
    ...fetched,
    title: local.title,
    status: local.status,
    priority: local.priority,
    url: local.url,
    dueAt: local.dueAt,
    dueHasTime: local.dueHasTime,
    tags: local.tags,
    recurrenceRule: local.recurrenceRule,
    recurrenceBasis: local.recurrenceBasis,
    updatedAt: local.updatedAt,
  }
})

/** 読み込めなかった。ローカルにも何も無いときだけ知らせる。 */
const error = computed(() => (item.value ? null : detailError.value))

/** まだサーバーへ送れていない変更を抱えているか。 */
const unsynced = computed(() => Boolean(cached.value && cached.value.syncState !== 'synced'))

/**
 * 本文と作業記録（Section）を扱えるか。
 *
 * Section はサーバーにしか置いていない。取れていないのに編集させると、
 * 書いたものが行き先を失うので、そのときは出さない（docs/12-offline.md 12.9）。
 */
const hasDetail = computed(() => Boolean(cachedDetail.value))

/**
 * 詳細が取れていないことを知らせるか。
 *
 * 取得の最中にも知らせると、たいていはすぐ届くので一瞬だけ出て消え、
 * その分だけ画面がずれる。オフラインだと分かっているときは即座に、
 * オンラインのつもりなのに返ってこないときは何秒か待ってから出す。
 */
const DETAIL_SLOW_MS = 4000
const detailSlow = ref(false)
let slowTimer: ReturnType<typeof setTimeout> | null = null

if (import.meta.client) {
  watch(
    [id, hasDetail],
    () => {
      if (slowTimer) clearTimeout(slowTimer)
      detailSlow.value = false
      // 届いたなら待つ必要はない。別の Item に切り替わったら数え直す
      if (hasDetail.value) return
      slowTimer = setTimeout(() => {
        detailSlow.value = true
      }, DETAIL_SLOW_MS)
    },
    { immediate: true },
  )

  onUnmounted(() => {
    if (slowTimer) clearTimeout(slowTimer)
  })
}

const showDetailNote = computed(
  () => !hasDetail.value && (!online.value || detailSlow.value),
)

// --- タイトル（リアルタイム保存） --------------------------------------

/**
 * 編集中の値。まだ触っていなければ null で、取得結果をそのまま見せる。
 *
 * setup 時点の値を ref に固定してしまうと、取得が終わるのが後になる
 * サーバー描画で空のまま出力され、ハイドレーションがずれる。
 */
const titleDraft = ref<string | null>(null)
const title = computed({
  get: () => titleDraft.value ?? item.value?.title ?? '',
  set: (value: string) => {
    titleDraft.value = value
  },
})

const titleSave = useAutosave({
  source: title,
  // 空のまま保存するとサーバー側で弾かれるので、入力中は送らない
  enabled: () => title.value.trim().length > 0,
  // ローカルへ書けば保存は済み。サーバーへの送信は useSync が引き受ける
  save: async (value) => {
    await store.patch([id.value], { title: value.trim() })
  },
})

/** タイトル横の●に出す状態。ローカル保存が済んでいても、サーバーへ未送信なら伝える。 */
const titleIndicatorState = computed<SaveDotState>(() =>
  titleSave.state.value === 'idle' && unsynced.value ? 'unsynced' : titleSave.state.value,
)

/**
 * タイトルは複数行での編集を想定していないため、`Enter` は改行ではなく
 * 確定として扱う（すぐに保存してフォーカスを外す）。
 *
 * 日本語入力の変換を確定する `Enter` まで拾ってしまわないよう、
 * 変換中は素通りさせる（ItemComposer.vue と同じ判定）。
 */
function onTitleKeydown(event: KeyboardEvent) {
  if (event.key !== 'Enter') return
  if (event.isComposing || event.keyCode === 229) return
  event.preventDefault()
  void titleSave.flush()
  ;(event.target as HTMLTextAreaElement).blur()
}

// --- 作業記録（リアルタイム保存） ----------------------------------------
//
// Item は本文を持たないため、書いた内容は日付付きの Section に入る
// （docs/02-data-model.md 2.10-1）。画面が既定で出している枠は
// **その日の作業記録**で、日をまたげば枠が分かれる
// （docs/03-functional-spec.md 3.2）。Section は書かれるまで作らない。

const sections = computed<SectionDto[]>(() => item.value?.sections ?? [])

/**
 * 既定で編集する枠に当たる Section。その日の記録がまだ無ければ null で、
 * 何か書かれた時点でストアが作る。
 */
const todaySection = computed<SectionDto | null>(() =>
  pickTodaySection(sections.value, today.value),
)

/**
 * 当日の枠より上に積む、確定済みの作業記録。
 *
 * 日付の古い順に並んでいるので、当日の枠のすぐ上が直近の記録になる。
 * 同じ日に複数あるときは、最後の1件だけが当日の枠になり、残りはここへ来る。
 */
const pastSections = computed<SectionDto[]>(() =>
  sections.value.filter((s) => s.id !== todaySection.value?.id),
)

/**
 * 当日の枠に書く内容。
 *
 * 下書きを画面側に持たない。打鍵はそのままストアへ渡し、送信はストアが
 * 遅らせて裏で行う（docs/15-client-state.md）。
 */
const todayBody = computed({
  get: () => detailStore.todayBodyOf(id.value, today.value) ?? '',
  set: (value: string) => detailStore.editTodayBody(id.value, today.value, value),
})

const todaySave = computed(() => detailStore.todayStatus(id.value))

const bodyEditor = ref<{ focus: () => void } | null>(null)

/**
 * 作業記録の欄を出すか。
 *
 * Section が取れていない間も、ローカル（IndexedDB）の写しに本文があるなら
 * 読むだけは出す。ただし写しが指すのは**その Item の最初の記録**なので、
 * 当日の枠としてではなく、確定済みの見た目で出す（下の template）。
 */
const showRecords = computed(() => hasDetail.value || Boolean(item.value?.body))

/** 当日の枠へフォーカスする。一覧の `y` から呼ばれる。 */
function focusBody() {
  bodyEditor.value?.focus()
}

/** 一覧のショートカット（`r` / `u` / `y`）から各欄へ移るために公開する。 */
const titleInput = ref<HTMLTextAreaElement | null>(null)
const urlInput = ref<HTMLInputElement | null>(null)

function focusEnd(el: HTMLTextAreaElement | HTMLInputElement | null) {
  if (!el) return
  el.focus()
  el.setSelectionRange(el.value.length, el.value.length)
}

/**
 * URL 欄へ移る（一覧の `u`）。
 *
 * URL が空のタスクでは欄そのものを出していない（値があるか、「詳細を追加」
 * から開いたときだけ出す）。そのままでは移る先が無く、`u` が何も起きない
 * キーになってしまうので、先に欄を出してから移る。
 */
async function focusUrl() {
  if (!showUrlRow.value) {
    urlFieldOpen.value = true
    // 描かれる前にフォーカスしても効かない
    await nextTick()
  }
  focusEnd(urlInput.value)
}

defineExpose({
  focusBody,
  focusTitle: () => focusEnd(titleInput.value),
  focusUrl,
  /** 一覧の `Shift` + `y` から、今日の作業記録へ移る。 */
  focusTodaySection: () => addTodaySection(),
})

/*
 * 一覧から移ってきたときに入る欄（`?focus=`。docs/08-todo-management.md 8.4）。
 *
 * 分割表示なら一覧が右ペインの欄へ直接移せるが、狭い画面には右ペインが無く、
 * 詳細画面へ移ってからでないと欄そのものが存在しない。そこで、どこへ
 * 入りたかったのかを URL で受け取り、開けたところで移る。
 */
const FOCUS_TARGETS: Record<string, () => void | Promise<void>> = {
  title: () => focusEnd(titleInput.value),
  url: () => focusUrl(),
  body: () => focusBody(),
  today: () => addTodaySection(),
}

const route = useRoute()
const router = useRouter()

/** 一度移ったら、それ以上は追いかけない。 */
let focusHandled = false

watch(
  () => item.value?.id,
  async (loadedId) => {
    // 分割表示は一覧が直接呼ぶので、こちらでは扱わない
    if (props.embedded || focusHandled || !loadedId) return

    const run = FOCUS_TARGETS[String(route.query.focus ?? '')]
    if (!run) return

    focusHandled = true
    await nextTick()
    await run()

    // 印は消す。再読み込みのたびに勝手に欄へ入らないようにする
    const query = { ...route.query }
    delete query.focus
    void router.replace({ query })
  },
  { immediate: true },
)

// --- URL（リアルタイム保存） -------------------------------------------

const urlDraft = ref<string | null>(null)
const url = computed({
  get: () => urlDraft.value ?? item.value?.url ?? '',
  set: (value: string) => {
    urlDraft.value = value
  },
})

const urlSave = useAutosave({
  source: url,
  // 入力途中は保存しない。書き終わって初めて http(s) の形になるため。
  enabled: () => !url.value.trim() || isOpenableUrl(url.value),
  save: async (value) => {
    await store.patch([id.value], { url: value.trim() || null })
  },
})

/**
 * 別画面での変更や再取得に追随する。編集中の内容は上書きしない。
 *
 * 触っていない欄（下書きが null）は、届いた内容をそのまま見せる。
 * このとき markSynced を忘れると、内容が届いただけで「変わった」と
 * 見なされ、同じ値をそのまま保存してしまう（オフラインでは、触っても
 * いないタスクに未同期の印が付く）。
 *
 * 本文はここに出てこない。下書きを持たず、サーバーの内容を当てるかどうかも
 * ストアが決めている（docs/15-client-state.md）。
 */
watch(item, (value) => {
  if (!value) return

  const titleIdle =
    titleSave.state.value === 'idle' || titleSave.state.value === 'saved'
  if (titleDraft.value === null || titleIdle) {
    titleDraft.value = null
    titleSave.markSynced()
  }

  const urlIdle = urlSave.state.value === 'idle' || urlSave.state.value === 'saved'
  if (urlDraft.value === null || urlIdle) {
    urlDraft.value = null
    urlSave.markSynced()
  }
})

// --- メタデータの操作 ---------------------------------------------------

const actionError = ref<string | null>(null)

/** 済んだことだけを伝える知らせ（「コピーした」）。少し待って自分で消える。 */
const actionMessage = ref<string | null>(null)
let actionMessageTimer: ReturnType<typeof setTimeout> | undefined

function notify(text: string) {
  actionMessage.value = text
  clearTimeout(actionMessageTimer)
  actionMessageTimer = setTimeout(() => {
    if (actionMessage.value === text) actionMessage.value = null
  }, 2500)
}

onUnmounted(() => clearTimeout(actionMessageTimer))

/**
 * 表示中のタスクをクリップボードへ写す（`⌘ + C`）。
 *
 * 中身の作りは一覧と同じ（composeItemCopyText）。写すのは一覧カードと同じ
 * 本文＝最初の作業記録で、当日の枠に書きかけの分ではない。同じキーなのに
 * 一覧と詳細で違うものが写ると、どちらが写ったのか分からなくなる。
 * まだ取得できていなくてもローカルの写しが `item` に入っている。
 */
async function copy() {
  if (!item.value) return

  actionError.value = null
  const source = { title: title.value, body: item.value.body ?? '' }
  // 打鍵の流れのまま書き込む。間に待ちを挟むとブラウザに拒まれる
  const written = await writeToClipboard(composeItemCopyText([source]))

  if (written) notify('コピーした')
  else actionError.value = 'コピーできませんでした'
}

/**
 * メタデータを変える。
 *
 * ローカル（IndexedDB）へ書いた時点で画面に出る。送信は useSync が
 * 裏で行うので、オフラインでも同じように操作できる。
 */
async function patch(values: ItemPatch) {
  if (!item.value) return
  actionError.value = null
  await store.patch([id.value], values)
}

const dueOpen = ref(false)
const tagOpen = ref(false)
const recurrenceOpen = ref(false)

// --- 重要度（RTM に倣い、タイトル横の色を押して切り替える） ----------------

const priorityOpen = ref(false)

async function setPriority(value: Priority | null) {
  priorityOpen.value = false
  await patch({ priority: value })
}

// --- 繰り返し ----------------------------------------------------------

const recurrence = computed<Recurrence | null>(() => {
  const value = item.value
  if (!value?.recurrenceRule || !value.recurrenceBasis) return null
  return { rule: value.recurrenceRule, basis: value.recurrenceBasis }
})

const recurrenceLabel = computed(() =>
  recurrence.value ? describeRecurrence(recurrence.value) : null,
)

async function applyRecurrence(value: Recurrence | null) {
  recurrenceOpen.value = false
  await patch({
    recurrenceRule: value?.rule ?? null,
    recurrenceBasis: value?.basis ?? null,
  })
}

// --- 詳細を追加（RTM に倣い、設定していない項目だけを出す） -----------------
//
// 繰り返しと URL は、設定していなければ行そのものを出さない。
// 「詳細を追加」から選んだときだけ、その場で入力欄・ダイアログを出す。

const detailMenuOpen = ref(false)
/** URL 欄を出すか。値があれば常に出す。無くても「詳細を追加」から開いたら出す。 */
const urlFieldOpen = ref(false)
const showUrlRow = computed(() => Boolean(item.value?.url) || urlFieldOpen.value)

function toggleDetailMenu() {
  priorityOpen.value = false
  detailMenuOpen.value = !detailMenuOpen.value
}

function openRecurrenceFromMenu() {
  detailMenuOpen.value = false
  recurrenceOpen.value = true
}

async function openUrlField() {
  detailMenuOpen.value = false
  urlFieldOpen.value = true
  await nextTick()
  urlInput.value?.focus()
}

const detailOptions = computed(() => {
  const options: { key: string; label: string; run: () => void }[] = []
  if (!recurrence.value) {
    options.push({ key: 'recurrence', label: '繰り返し', run: openRecurrenceFromMenu })
  }
  if (!showUrlRow.value) {
    options.push({ key: 'url', label: 'URL', run: openUrlField })
  }
  return options
})

// 別のタスクへ移ったら、開きかけのポップオーバーや「詳細を追加」で
// 出した空欄は持ち越さない。
watch(id, () => {
  priorityOpen.value = false
  detailMenuOpen.value = false
  urlFieldOpen.value = false
})

/**
 * 単独表示（`embedded` でない）でだけ持つショートカット。
 * 分割表示では一覧側が同じキーを持っているので、二重には登録しない。
 *
 * - `Esc` … 一覧へ戻る（分割表示では一覧がそのまま見えているので不要）
 * - `⌘ + C` … このタスクを写す（一覧では `list.copy`）
 *
 * タイトルや本文など、入力欄にフォーカスがある間は対象にしない
 * （`useShortcuts` の既定どおり）。編集中の `Esc` を横取りすると、
 * 書きかけのまま一覧へ飛んでしまうため。ポップオーバーは開いていれば
 * 閉じるだけにして、一覧へは戻さない。
 */
useShortcuts(
  computed<Shortcut[]>(() =>
    props.embedded
      ? []
      : [
          {
            keys: ['Escape'],
            display: 'Esc',
            label: '一覧へ戻る',
            group: 'その他',
            run: () => {
              if (priorityOpen.value || detailMenuOpen.value) {
                priorityOpen.value = false
                detailMenuOpen.value = false
                return
              }
              void navigateTo(listOrigin.value)
            },
          },
          {
            // 一覧と同じ割り当て。文字を選んでいればブラウザのコピーに譲る
            keys: ['c'],
            display: 'C',
            meta: true,
            label: 'タイトルと本文をコピー',
            group: 'その他',
            yieldToBrowser: () => document.getSelection()?.isCollapsed === false,
            run: () => copy(),
          },
        ],
  ),
)

/** 同じ繰り返しから生まれた過去のオカレンス。 */
const seriesId = computed(() => item.value?.seriesId ?? null)

function occurrenceDate(entry: ItemDto): string {
  return entry.dueAt
    ? new Date(entry.dueAt).toLocaleDateString('ja-JP')
    : '期限なし'
}

/**
 * 系列の過去分。
 *
 * 手元にある Item から選ぶ。全件がローカルにあるので取りに行く必要がなく、
 * オフラインでも同じものが出る。
 */
const pastOccurrences = computed(() => {
  const current = seriesId.value
  if (!current) return []
  return store.items.value
    .filter((entry) => entry.seriesId === current && entry.id !== id.value)
    .filter((entry) => entry.syncState !== 'pending_delete')
    .sort((a, b) => ((a.dueAt ?? '') > (b.dueAt ?? '') ? -1 : 1))
})

async function applyTags(changes: { add: string[]; remove: string[] }) {
  tagOpen.value = false
  if (!item.value) return

  actionError.value = null
  await store.applyTags([id.value], changes.add, changes.remove)
}

async function applyDue(due: { date: Date; hasTime: boolean } | null) {
  dueOpen.value = false
  await patch({
    dueAt: due?.date.toISOString() ?? null,
    dueHasTime: due?.hasTime ?? false,
  })
}

const dueLabel = computed(() =>
  item.value ? formatDue(item.value) : { label: '', state: 'none' as const },
)

async function remove() {
  if (!confirm('このタスクを削除します。よろしいですか？')) return
  // ローカルで消して先へ進む。サーバーへの削除は useSync が送る
  await store.remove([id.value])
  emit('removed', id.value)
  // 消した詳細は履歴に残っているので、戻るのではなく一覧へ進める
  if (!props.embedded) await navigateTo(listOrigin.value)
}

// --- 日々の作業記録（docs/03-functional-spec.md 3.2） ---------------------

const addingSection = ref(false)

/**
 * 同じ日付の中で前後に動かせるか。
 * position は同一日付内の並び順なので、日付をまたいでは動かさない。
 */
function canMove(index: number, delta: -1 | 1): boolean {
  const list = pastSections.value
  const current = list[index]
  const next = list[index + delta]
  return Boolean(current && next && current.date === next.date)
}

/**
 * 今日の作業記録へ移る（`Shift` + `y` / 「今日の記録を追加」）。
 *
 * 当日の枠はいつでも出ているので、たいていはそこへフォーカスするだけで足りる。
 * すでに書き込まれているときだけ、同じ日の2件目を作る（同一日付に複数の記録を
 * 置けるのは docs/03-functional-spec.md 3.2 のとおり）。新しく作ったものが
 * 当日の枠になり、それまでの分は確定済みとして上へ回る。
 */
async function addTodaySection() {
  const current = todaySection.value
  if (!current || !current.body.trim()) {
    focusBody()
    return
  }

  addingSection.value = true
  try {
    await detailStore.addSection(id.value, today.value)
    emit('changed')
    await nextTick()
    focusBody()
  } finally {
    addingSection.value = false
  }
}

async function changeSectionDate(section: SectionDto, date: string) {
  actionError.value = null
  try {
    await detailStore.changeSectionDate(id.value, section.id, date)
  } catch {
    actionError.value = '日付を変更できませんでした'
  }
}

/** 同じ日付の記録どうしを入れ替える。並びはまとめて送る。 */
async function moveSection(index: number, delta: -1 | 1) {
  const list = pastSections.value
  const current = list[index]
  const other = list[index + delta]
  if (!current || !other || current.date !== other.date) return

  // 並びは、当日の枠になっている記録も含めたその日の全件で送る。
  // 抜いて送ると、残った1件の position が重なったままになる
  const ids = sections.value
    .filter((s) => s.date === current.date)
    .map((s) => s.id)
  const from = ids.indexOf(current.id)
  const to = ids.indexOf(other.id)
  ids[from] = other.id
  ids[to] = current.id

  actionError.value = null
  try {
    await detailStore.reorderSections(id.value, ids)
  } catch {
    actionError.value = '並べ替えできませんでした'
  }
}

async function removeSection(section: SectionDto) {
  if (!confirm('この作業記録を削除します。よろしいですか？')) return

  actionError.value = null
  try {
    await detailStore.removeSection(id.value, section.id)
    emit('changed')
  } catch {
    actionError.value = '削除できませんでした'
  }
}
</script>

<template>
  <div class="page">
    <p v-if="error" class="page__error" role="alert">
      タスクを読み込めませんでした
    </p>

    <p v-else-if="!item" class="page__placeholder">読み込み中…</p>

    <template v-else>
      <NuxtLink v-if="!embedded" :to="listOrigin" class="page__back">← 一覧へ</NuxtLink>

      <header class="head">
        <div class="head__top">
          <!--
            重要度は RTM に倣い、タイトル横の色で表す。押すと候補が出て
            そのまま切り替えられる（一覧の「重要度は左端の色」と同じ考え方）。
          -->
          <button
            type="button"
            class="head__priority"
            :class="`head__priority--${item.priority ?? 'none'}`"
            :aria-label="`重要度: ${item.priority ? PRIORITY_LABELS[item.priority] : 'なし'}（押して変更）`"
            aria-haspopup="listbox"
            :aria-expanded="priorityOpen"
            @click="priorityOpen = !priorityOpen"
          />

          <!-- タイトルもボタンなしで保存する -->
          <textarea
            ref="titleInput"
            v-model="title"
            class="head__title"
            rows="1"
            aria-label="タイトル"
            @input="(e) => {
              const el = e.target as HTMLTextAreaElement
              el.style.height = 'auto'
              el.style.height = `${el.scrollHeight}px`
            }"
            @keydown="onTitleKeydown"
          />

          <div v-if="priorityOpen" class="head__priority-backdrop" @click="priorityOpen = false" />
          <ul v-if="priorityOpen" class="head__priority-menu" role="listbox" aria-label="重要度を選ぶ">
            <li v-for="value in PRIORITIES" :key="value">
              <button
                type="button"
                class="head__priority-option"
                role="option"
                :aria-selected="item.priority === value"
                @click="setPriority(value)"
              >
                <span class="head__priority-dot" :class="`head__priority-dot--${value}`" aria-hidden="true" />
                優先度{{ PRIORITY_LABELS[value] }}
              </button>
            </li>
            <li>
              <button
                type="button"
                class="head__priority-option"
                role="option"
                :aria-selected="item.priority === null"
                @click="setPriority(null)"
              >
                <span class="head__priority-dot head__priority-dot--none" aria-hidden="true" />
                優先度なし
              </button>
            </li>
          </ul>
        </div>
        <SaveDot class="head__save" :state="titleIndicatorState" />
      </header>

      <p v-if="actionError" class="page__error" role="alert">{{ actionError }}</p>
      <p v-else-if="actionMessage" class="page__note" role="status">{{ actionMessage }}</p>

      <!--
        何ができて何ができないかを短く伝える。
        取得の途中では出さない（出しては消えると画面がずれる）。
      -->
      <p v-if="showDetailNote" class="page__note">
        <template v-if="online">
          本文と作業記録を読み込めていません。
        </template>
        <template v-else>
          オフラインです。
          状態・期限・重要度・タグ・タイトルはこの端末に保存され、繋がったときに送ります。
          本文と作業記録は繋がってから編集できます。
        </template>
      </p>

      <section class="meta">
        <div class="meta__row">
          <span class="meta__label">状態</span>
          <div class="meta__values">
            <button
              v-for="status in ITEM_STATUSES"
              :key="status"
              type="button"
              class="chip"
              :class="{ 'chip--active': item.status === status }"
              @click="patch({ status })"
            >
              {{ STATUS_LABELS[status as ItemStatus] }}
            </button>
          </div>

          <!--
            RTM の「タスクの詳細を入力」に倣い、繰り返し・URL のうち
            まだ設定していないものだけをここから追加できるようにする。
            両方設定済みなら足すものが無いので出さない。
            専用の行にすると縦に嵩むので、状態と同じ行の右端に置く。
          -->
          <div v-if="detailOptions.length" class="meta__add-wrap">
            <button
              type="button"
              class="meta__add"
              aria-haspopup="menu"
              :aria-expanded="detailMenuOpen"
              @click="toggleDetailMenu"
            >
              詳細を追加 <span aria-hidden="true">▾</span>
            </button>
            <div v-if="detailMenuOpen" class="meta__add-backdrop" @click="detailMenuOpen = false" />
            <ul v-if="detailMenuOpen" class="meta__add-menu" role="menu">
              <li v-for="option in detailOptions" :key="option.key">
                <button
                  type="button"
                  class="meta__add-option"
                  role="menuitem"
                  @click="option.run()"
                >
                  {{ option.label }}
                </button>
              </li>
            </ul>
          </div>
        </div>

        <div v-if="showUrlRow" class="meta__row">
          <span class="meta__label">URL</span>
          <input
            ref="urlInput"
            v-model="url"
            class="meta__url"
            type="url"
            inputmode="url"
            placeholder="https://..."
            aria-label="URL"
          />
          <a
            v-if="item.url && isOpenableUrl(item.url)"
            class="meta__open"
            :href="item.url"
            target="_blank"
            rel="noopener noreferrer"
          >開く</a>
          <SaveDot class="meta__save" :state="urlSave.state.value" />
        </div>

        <div class="meta__row">
          <span class="meta__label">タグ</span>
          <div class="meta__values">
            <NuxtLink
              v-for="name in item.tags"
              :key="name"
              class="chip chip--tag"
              :style="{
                '--tag-color': tagColorVar(colorOf(name)),
                '--tag-text': tagTextColorVar(colorOf(name)),
              }"
              :to="{ path: '/', query: { tag: name } }"
            >
              {{ name }}
            </NuxtLink>
            <button type="button" class="chip chip--quiet" @click="tagOpen = true">
              {{ item.tags.length ? '変更する' : '追加する' }}
            </button>
          </div>
        </div>

        <div v-if="recurrence" class="meta__row">
          <span class="meta__label">繰り返し</span>
          <div class="meta__values">
            <button type="button" class="chip" @click="recurrenceOpen = true">
              {{ recurrenceLabel }}
            </button>
            <button type="button" class="chip chip--quiet" @click="applyRecurrence(null)">
              やめる
            </button>
          </div>
        </div>

        <div class="meta__row">
          <span class="meta__label">期限</span>
          <div class="meta__values">
            <button type="button" class="chip" @click="dueOpen = true">
              {{ dueLabel.state === 'none' ? '設定する' : dueLabel.label }}
            </button>
            <button
              v-if="item.dueAt"
              type="button"
              class="chip chip--quiet"
              @click="patch({ dueAt: null })"
            >
              外す
            </button>
          </div>
        </div>
      </section>

      <!--
        作業記録。日付の古い順に積み、**当日の枠を一番下**に置く
        （docs/03-functional-spec.md 3.2）。過去の分は確定済みの見た目で、
        編集アイコンを押したときだけ書ける。
      -->
      <section v-if="showRecords" class="log">
        <h2 class="log__title">作業記録</h2>

        <!--
          まだ Section を取れていない。書ける枠を出すと、書いたものの行き先が
          無い（docs/12-offline.md 12.9）。写しにある本文だけを読むだけで出す。
          写しが指すのは最初の記録なので、当日の枠のようには見せない。
        -->
        <ScrapboxEditor
          v-if="!hasDetail"
          view
          :model-value="item.body ?? ''"
          aria-label="本文"
        />

        <template v-else>
          <ItemSectionRecord
            v-for="(section, index) in pastSections"
            :key="section.id"
            :item-id="id"
            :section="section"
            :can-move-up="canMove(index, -1)"
            :can-move-down="canMove(index, 1)"
            @change-date="(date) => changeSectionDate(section, date)"
            @move="(delta) => moveSection(index, delta)"
            @remove="removeSection(section)"
          />

          <article class="today">
            <header class="today__head">
              <span class="today__date">{{ formatAppDate(today) }}</span>
              <span class="today__badge">今日</span>
              <!-- 作業記録と日記は日付だけで結び付く（docs/02-data-model.md 2.8） -->
              <NuxtLink class="today__diary" :to="`/diary/${today}`">日記</NuxtLink>
              <SaveDot class="today__save" :state="todaySave.state" />
            </header>
            <ScrapboxEditor
              ref="bodyEditor"
              v-model="todayBody"
              placeholder="今日やったこと"
              aria-label="今日の作業記録"
            />
            <p v-if="todaySave.error" class="page__error" role="alert">
              {{ todaySave.error }}
            </p>
          </article>
        </template>
      </section>

      <section v-if="pastOccurrences.length" class="series">
        <h2 class="series__title">この繰り返しの過去分</h2>
        <ul class="series__list">
          <li v-for="past in pastOccurrences" :key="past.id">
            <!-- 分割表示では画面遷移せず、右ペインの表示だけを切り替える -->
            <button
              v-if="embedded"
              type="button"
              class="series__item"
              @click="emit('selectSeries', past.id)"
            >
              <span class="series__due">{{ occurrenceDate(past) }}</span>
              <span class="series__status">{{ STATUS_LABELS[past.status] }}</span>
            </button>
            <NuxtLink v-else class="series__item" :to="`/items/${past.id}`">
              <span class="series__due">{{ occurrenceDate(past) }}</span>
              <span class="series__status">{{ STATUS_LABELS[past.status] }}</span>
            </NuxtLink>
          </li>
        </ul>
      </section>

      <div class="page__actions">
        <button
          v-if="hasDetail"
          type="button"
          class="page__add"
          :disabled="addingSection"
          @click="addTodaySection"
        >
          今日の作業記録を追加
        </button>
        <button type="button" class="page__delete" @click="remove">
          このタスクを削除
        </button>
      </div>

      <DueDialog v-if="dueOpen" :count="1" @submit="applyDue" @close="dueOpen = false" />

      <RecurrenceDialog
        v-if="recurrenceOpen"
        :count="1"
        :current="recurrence"
        @submit="applyRecurrence"
        @close="recurrenceOpen = false"
      />

      <TagDialog
        v-if="tagOpen"
        :tags="item.tags"
        :count="1"
        @apply="applyTags"
        @close="tagOpen = false"
      />
    </template>
  </div>
</template>

<style scoped>
.page {
  display: grid;
  /*
   * 列は必ず親の幅に収める。既定（auto）だと、中身のいちばん広いものの
   * 最小幅まで列が広がる。タイトルの入力欄（textarea）は 20 文字ぶんの
   * 固有幅を持つため、狭い端末や文字を大きくした端末ではページごと
   * 横スクロールし、少し縮小して表示される。
   */
  grid-template-columns: minmax(0, 1fr);
  gap: 1rem;
}

.page__back {
  color: var(--text-muted);
  text-decoration: none;
  font-size: 0.875rem;
  justify-self: start;
}

.page__error {
  margin: 0;
  color: var(--danger);
  font-size: 0.875rem;
}

.page__note {
  margin: 0;
  color: var(--text-muted);
  font-size: 0.8125rem;
}

.page__placeholder {
  margin: 0;
  color: var(--text-muted);
  text-align: center;
  padding: 2rem 0;
}

.head {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 0.25rem;
}

.head__top {
  position: relative;
  display: flex;
  align-items: stretch;
  gap: 0.5rem;
}

.head__title {
  /*
   * 基準を 0 にする。textarea は既定で 20 文字ぶんの固有幅を持ち、それを
   * 基準にすると、狭い端末や文字を大きくした端末で行ごと画面より広くなる
   * （ページが横スクロールし、少し縮小して表示される）。
   */
  flex: 1 1 0;
  min-width: 0;
  resize: none;
  background: transparent;
  border: 0;
  border-bottom: 1px solid transparent;
  outline: none;
  color: var(--text);
  font-size: 1.25rem;
  font-weight: 700;
  line-height: 1.4;
  padding: 0.25rem 0;
  overflow: hidden;
}

.head__title:focus {
  border-bottom-color: var(--border);
}

/*
 * 重要度は一覧のカードと同じく色の帯で表す（RTM に倣う）。
 * ここでは押せるボタンにして、押すと候補を出す。
 */
.head__priority {
  flex: 0 0 auto;
  width: 0.375rem;
  align-self: stretch;
  min-height: 1.75rem;
  border: 0;
  border-radius: 999px;
  padding: 0;
  cursor: pointer;
  background: var(--priority-none);
}

.head__priority--1 {
  background: var(--priority-1);
}

.head__priority--2 {
  background: var(--priority-2);
}

.head__priority--3 {
  background: var(--priority-3);
}

.head__priority-backdrop {
  position: fixed;
  inset: 0;
  z-index: 30;
}

.head__priority-menu {
  position: absolute;
  top: 100%;
  left: 0;
  z-index: 31;
  margin: 0.25rem 0 0;
  padding: 0.25rem;
  list-style: none;
  min-width: 9rem;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 8px;
  box-shadow: var(--shadow);
}

.head__priority-option {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  width: 100%;
  background: transparent;
  border: 0;
  border-radius: 6px;
  padding: 0.5rem 0.625rem;
  font: inherit;
  font-size: 0.875rem;
  color: var(--text);
  text-align: left;
  cursor: pointer;
}

.head__priority-option:hover,
.head__priority-option:focus-visible {
  background: color-mix(in srgb, var(--accent) 10%, transparent);
}

.head__priority-dot {
  flex: 0 0 auto;
  width: 0.625rem;
  height: 0.625rem;
  border-radius: 999px;
  background: var(--priority-none);
}

.head__priority-dot--1 {
  background: var(--priority-1);
}

.head__priority-dot--2 {
  background: var(--priority-2);
}

.head__priority-dot--3 {
  background: var(--priority-3);
}

/*
 * RTM のように、ラベルと値を同じ行に収めて縦を詰める。
 * ラベルは行ごとの折り返し行を持たせず、値（チップ）とまとめて
 * 1つの flex 行にする。狭い画面ではチップだけ次の行へ折り返す。
 */
.meta {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 0.375rem;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 0.625rem 0.75rem;
}

.meta__row {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 0.5rem;
}

.meta__label {
  flex: 0 0 auto;
  min-width: 3.25rem;
  font-size: 0.8125rem;
  color: var(--text-muted);
}

.meta__open {
  flex: 0 0 auto;
  color: var(--accent);
  font-size: 0.8125rem;
}

.meta__url {
  font: inherit;
  /* iOS でフォーカス時に自動ズームされないよう 16px を保つ */
  font-size: 1rem;
  flex: 1 1 10rem;
  min-width: 0;
  min-height: 2rem;
  padding: 0 0.625rem;
  background: var(--bg);
  color: var(--text);
  border: 1px solid var(--border);
  border-radius: 8px;
}

.meta__values {
  display: flex;
  flex-wrap: wrap;
  /* 値が長くても、行ごと画面より広くならないようにする */
  min-width: 0;
  gap: 0.375rem;
}

.chip {
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 999px;
  color: var(--text);
  min-height: 2rem;
  padding: 0 0.625rem;
  font-size: 0.8125rem;
}

.chip--active {
  background: var(--accent);
  border-color: var(--accent);
  color: var(--accent-text);
  font-weight: 600;
}

.chip--quiet {
  color: var(--text-muted);
}

.chip--link {
  color: var(--accent);
  text-decoration: none;
  display: inline-flex;
  align-items: center;
}

/*
 * RTM 風の塗りつぶしピル。文字色は色見本と対になっている色を使う
 * （main.css の --tag-* / --tag-*-fg）。一覧側のタグ表示（ItemCard.vue の
 * .card__tag）とサイズ・見た目をそろえる。`.chip` の見出しボタンとしての
 * サイズ（min-height）や下線は要らない。
 */
.chip--tag {
  display: inline-flex;
  align-items: center;
  min-height: 0;
  padding: 0.0625rem 0.5rem;
  background: var(--tag-color);
  border-color: var(--tag-color);
  color: var(--tag-text);
  font-size: 0.75rem;
  font-weight: 600;
  line-height: 1.6;
  text-decoration: none;
}

/*
 * RTM の「タスクの詳細を入力」に倣った、未設定の項目を足すための欄。
 * 常設の行より控えめに（破線・薄い色で）出す。
 */
.meta__add-wrap {
  position: relative;
  margin-left: auto;
}

.meta__add {
  background: transparent;
  border: 1px dashed var(--border);
  border-radius: 999px;
  color: var(--text-muted);
  min-height: 2rem;
  padding: 0 0.75rem;
  font-size: 0.8125rem;
}

.meta__add-backdrop {
  position: fixed;
  inset: 0;
  z-index: 30;
}

.meta__add-menu {
  position: absolute;
  top: 100%;
  left: 0;
  z-index: 31;
  margin: 0.25rem 0 0;
  padding: 0.25rem;
  list-style: none;
  min-width: 9rem;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 8px;
  box-shadow: var(--shadow);
}

.meta__add-option {
  display: block;
  width: 100%;
  background: transparent;
  border: 0;
  border-radius: 6px;
  padding: 0.5rem 0.625rem;
  font: inherit;
  font-size: 0.875rem;
  color: var(--text);
  text-align: left;
  cursor: pointer;
}

.meta__add-option:hover,
.meta__add-option:focus-visible {
  background: color-mix(in srgb, var(--accent) 10%, transparent);
}

/* 当日の枠。書ける欄はここだけなので、日付を添えて見分けられるようにする */
.today {
  display: grid;
  gap: 0.375rem;
}

.today__head {
  display: flex;
  align-items: center;
  gap: 0.375rem;
}

.today__date {
  font-size: 0.8125rem;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  padding-left: 1rem;
}

.today__badge {
  font-size: 0.6875rem;
  color: var(--accent);
  border: 1px solid var(--accent);
  border-radius: 999px;
  padding: 0.0625rem 0.375rem;
}

.today__diary {
  color: var(--text-muted);
  text-decoration: none;
  font-size: 0.75rem;
  border: 1px solid var(--border);
  border-radius: 999px;
  padding: 0.0625rem 0.5rem;
}

.today__save {
  flex: 1;
}

.log__title {
  margin: 0;
  font-size: 0.8125rem;
  color: var(--text-muted);
  font-weight: 600;
}

.series {
  display: grid;
  gap: 0.5rem;
}

/* 記録どうしは、日をまたいだ別の記録だと分かる程度に離す */
.log {
  display: grid;
  gap: 1rem;
}

.series__title {
  margin: 0;
  font-size: 0.8125rem;
  color: var(--text-muted);
  font-weight: 600;
}

.series__list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: 0.25rem;
}

.series__item {
  width: 100%;
  font: inherit;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 0.5rem 0.75rem;
  min-height: 2.5rem;
  color: inherit;
  text-decoration: none;
  font-size: 0.875rem;
}

.series__due {
  font-variant-numeric: tabular-nums;
}

.series__status {
  color: var(--text-muted);
  font-size: 0.8125rem;
}

.page__actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  gap: 0.5rem;
  padding-top: 0.5rem;
}

.page__add {
  background: transparent;
  border: 1px solid var(--border);
  border-radius: 8px;
  color: var(--text);
  min-height: 2.75rem;
  padding: 0 0.875rem;
}

.page__add:disabled {
  opacity: 0.5;
}

.page__delete {
  background: transparent;
  border: 0;
  color: var(--danger);
  min-height: 2.75rem;
  padding: 0 0.5rem;
  font-size: 0.875rem;
}
</style>
