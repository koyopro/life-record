<script setup lang="ts">
import { PRIORITY_LABELS, STATUS_LABELS } from '~~/shared/types/item'
import { formatAppDate, toAppDate } from '~~/shared/utils/date'
import { buildItemDraft } from '~/utils/item-draft'
import { resolveTodoLink } from '~/utils/todo-link'

/**
 * 本文の TODO リンクを押したときに出るポップオーバー
 * （docs/11-scrapbox-notation.md 11.13）。
 *
 * 出すのは「そのタスクが何か」と「今日の作業記録の入力欄」だけ。日記を
 * 書いている流れを切らずに、その場で記録を足せるようにするためのもので、
 * タスクの詳細をここで作り直さない（読み書きするものが増えたら「TODO を
 * 開く」で詳細へ移る）。
 *
 * 作業記録は詳細画面とまったく同じ経路（`useItemDetailStore` の当日の枠）で
 * 書く。専用のモデルも API も作らない（docs/02-data-model.md 2.4）。
 */
const { request, close, confirm } = useTodoLinkPopover()

const itemStore = useItemStore()
const detailStore = useItemDetailStore()
const diaryStore = useDiaryStore()
const today = useToday()
const compact = useCompactLayout()

/** リンク先の TODO。決まっていない・消されていれば null。 */
const item = computed(() => {
  const id = request.value?.itemId
  return id ? (itemStore.byId(id) ?? null) : null
})

/**
 * 同じ題の TODO。**リンク先がまだ決まっていないときだけ**探す。
 *
 * 決まっているリンク（`[/items/<id> 題]`）は id が正で、同じ題の TODO が
 * 何件あっても関係しない（docs/11-scrapbox-notation.md 11.13）。
 */
const match = computed(() =>
  request.value && !request.value.itemId
    ? resolveTodoLink(itemStore.items.value, request.value.text)
    : null,
)

/** 選んでもらう候補（同じ題が複数あるとき）。 */
const candidates = computed(() =>
  match.value?.kind === 'many' ? match.value.items : [],
)

/**
 * いま何を出しているか。
 *
 * - `loading` … 手元の一覧をまだ読めていない（「ありません」と言えない）
 * - `record` … リンク先が決まっている。今日の作業記録を書く
 * - `choose` … 同じ題が複数ある。どれを指すのか選んでもらう
 * - `missing` … 同じ題が無い。作るかどうかを尋ねる
 * - `gone` … 決まっている id の TODO が見つからない（消された可能性）
 */
type View = 'loading' | 'record' | 'choose' | 'missing' | 'gone'

const view = computed<View>(() => {
  if (!request.value) return 'loading'
  if (item.value) return 'record'
  // 読み込みが済むまでは「無い」と決めない（消された、と誤って見せないため）
  if (!itemStore.hydrated.value) return 'loading'
  if (request.value.itemId) return 'gone'
  return match.value?.kind === 'many' ? 'choose' : 'missing'
})

/*
 * 同じ題が1件だけなら、それをリンク先にする（docs 11.13 の解決規則）。
 *
 * 決めた時点で本文は `[/items/<id> 題]` に変わるので、あとから同じ題の
 * TODO が増えても、このリンクの行き先は動かない。
 */
watch([match, () => itemStore.hydrated.value], () => {
  if (match.value?.kind === 'one') confirm(match.value.item.id)
})

// --- 今日の作業記録 -------------------------------------------------------

const draft = ref('')
const saving = ref(false)
const saved = ref(false)
const errorMessage = ref<string | null>(null)
const input = ref<HTMLTextAreaElement | null>(null)

/** その日の枠に入っている、保存済みの内容。 */
const stored = computed(() =>
  item.value ? (detailStore.todayBodyOf(item.value.id, today.value) ?? '') : '',
)

const saveState = computed(() =>
  item.value ? detailStore.todayStatus(item.value.id, today.value) : null,
)

/** 書くものが無ければ押させない（空の記録は作らない。docs 3.2）。 */
const canSave = computed(() => Boolean(draft.value.trim()) || Boolean(stored.value))

/**
 * リンク先が決まったら、その日の記録を手元から読み直して入力欄に入れる。
 *
 * 読み直さないと、詳細画面を開いたことのないタスクでは「記録がまだ無い」
 * と見なして**別の記録を作ってしまう**（`editTodayBody` は手元にある記録
 * から当日の枠を決めるため）。
 */
watch(
  () => request.value?.itemId ?? null,
  async (id) => {
    saved.value = false
    errorMessage.value = null
    draft.value = ''
    if (!id) return

    await detailStore.reload(id)
    draft.value = detailStore.todayBodyOf(id, today.value) ?? ''
  },
  { immediate: true },
)

/** 開いたら入力欄へ。狭い画面ではキーボードで隠れるので当てない。 */
watch([view, compact], async ([value, narrow]) => {
  if (value !== 'record' || narrow) return
  await nextTick()
  input.value?.focus()
})

/**
 * 今日の作業記録を書き込む。
 *
 * 詳細画面の当日の枠と同じ `editTodayBody` を通すので、その日の記録が
 * すでにあれば書き足し、無ければ作る。日記の「この日にやったこと」は
 * 手元の作業記録から作られるので（docs/02-data-model.md 2.8）、書いたぶんを
 * すぐ出せるように作り直す。
 */
async function record() {
  const target = item.value
  if (!target || saving.value || !canSave.value) return

  saving.value = true
  errorMessage.value = null
  try {
    await detailStore.editTodayBody(target.id, today.value, draft.value)
    await diaryStore.loadWorkedOn(today.value)
    saved.value = true
  } catch {
    errorMessage.value = '記録できませんでした'
  } finally {
    saving.value = false
  }
}

/**
 * 題からタスクを作り、そのままリンク先にする。
 *
 * 一覧の入力欄・共有の受付と同じ組み立て（`buildItemDraft`）を通す。
 * id は手元で決まるので、オフラインでもそのままリンク先にできる
 * （docs/12-offline.md 12.6）。
 */
async function create(andRecord: boolean) {
  const text = request.value?.text
  if (!text || saving.value) return

  const built = buildItemDraft(text)
  if ('error' in built) {
    errorMessage.value = built.error
    return
  }

  saving.value = true
  try {
    await itemStore.create(built.draft, text)
    confirm(built.draft.id)
  } catch {
    errorMessage.value = '作成できませんでした'
    return
  } finally {
    saving.value = false
  }

  if (!andRecord) close()
}

function openItem() {
  const id = item.value?.id
  if (!id) return
  close()
  void navigateTo(`/items/${id}`)
}

// --- 出す場所 -------------------------------------------------------------
//
// 広い画面では押したリンクの近くに、狭い画面では下端のシートとして出す
// （操作シート・ダイアログと同じ。docs/08-todo-management.md 8.4）。

/** 目安の大きさ。画面の端からはみ出させないための計算に使う。 */
const WIDTH = 320
const HEIGHT = 340
const GAP = 6

const position = computed(() => {
  const anchor = request.value?.anchor
  if (!anchor || compact.value || !import.meta.client) return undefined

  const left = Math.min(
    Math.max(anchor.left, GAP),
    Math.max(window.innerWidth - WIDTH - GAP, GAP),
  )

  // 下に入りきらず、上には入るなら上へ出す（画面外に置かない）
  const below = window.innerHeight - anchor.bottom
  const above = anchor.top
  const style: Record<string, string> = { left: `${left}px`, width: `${WIDTH}px` }

  if (below < HEIGHT && above > below) {
    style.bottom = `${Math.max(window.innerHeight - anchor.top + GAP, GAP)}px`
  } else {
    style.top = `${Math.max(anchor.bottom + GAP, GAP)}px`
  }
  return style
})
</script>

<template>
  <!--
    ダイアログと同じく body へ出す（Teleport）。本文の中に置くと、
    折り返しや overflow の中に閉じ込められる。
  -->
  <Teleport to="body">
    <div
      v-if="request"
      class="overlay"
      :class="{ 'overlay--compact': compact }"
      @click.self="close"
    >
      <div
        class="pop"
        :class="{ 'pop--compact': compact }"
        :style="position"
        role="dialog"
        aria-modal="true"
        :aria-label="`「${request.text}」`"
        @keydown.esc.prevent="close"
      >
        <header class="pop__head">
          <p class="pop__title">{{ item?.title ?? request.text }}</p>
          <button type="button" class="pop__close" aria-label="閉じる" @click="close">
            <span aria-hidden="true">×</span>
          </button>
        </header>

        <p v-if="view === 'loading'" class="pop__note">読み込み中…</p>

        <!-- 決まっている id の TODO が無い。消された可能性があるので作り直さない -->
        <template v-else-if="view === 'gone'">
          <p class="pop__note">このTODOは見つかりません（削除された可能性があります）</p>
          <div class="pop__actions">
            <button type="button" class="pop__button" @click="close">閉じる</button>
          </div>
        </template>

        <!-- 同じ題が複数。**こちらでは決めず**、選んでもらう -->
        <template v-else-if="view === 'choose'">
          <p class="pop__note">「{{ request.text }}」のリンク先を選択</p>
          <ul class="choices">
            <li v-for="candidate in candidates" :key="candidate.id">
              <button type="button" class="choices__item" @click="confirm(candidate.id)">
                <span class="choices__title">{{ candidate.title }}</span>
                <span class="choices__meta">
                  {{ STATUS_LABELS[candidate.status] }}
                  <template v-if="candidate.priority">
                    · 重要度{{ PRIORITY_LABELS[candidate.priority] }}
                  </template>
                  · 更新: {{ formatAppDate(toAppDate(new Date(candidate.updatedAt))) }}
                </span>
              </button>
            </li>
          </ul>
          <button
            type="button"
            class="pop__button pop__button--wide"
            :disabled="saving"
            @click="create(true)"
          >
            ＋ 新しいTODOを作成
          </button>
        </template>

        <!-- 同じ題が無い。作ってから記録するところまで一続きにする -->
        <template v-else-if="view === 'missing'">
          <p class="pop__note">TODOがありません</p>
          <div class="pop__stack">
            <button
              type="button"
              class="pop__button pop__button--primary"
              :disabled="saving"
              @click="create(true)"
            >
              TODOを作成して記録する
            </button>
            <button
              type="button"
              class="pop__button"
              :disabled="saving"
              @click="create(false)"
            >
              TODOを作成する
            </button>
          </div>
        </template>

        <template v-else>
          <p class="pop__meta">
            {{ STATUS_LABELS[item!.status] }}
            <template v-if="item!.priority">
              · 重要度{{ PRIORITY_LABELS[item!.priority] }}
            </template>
          </p>

          <!--
            当日の枠（docs/03-functional-spec.md 3.2）。すでにその日の記録が
            あれば、その内容を出したうえで書き足せるようにする。1つのタスクの
            記録は同じ日に1件なので、別の記録を作らない。
          -->
          <label class="pop__label" for="todo-link-record">今日の作業記録</label>
          <textarea
            id="todo-link-record"
            ref="input"
            v-model="draft"
            class="pop__input"
            rows="4"
            placeholder="今日やったこと"
            @input="saved = false"
          />

          <p v-if="errorMessage" class="pop__error" role="alert">{{ errorMessage }}</p>
          <p v-else-if="saveState?.error" class="pop__error" role="alert">
            {{ saveState.error }}
          </p>
          <p v-else-if="saved" class="pop__saved" role="status">
            {{ saveState?.state === 'pending' ? '記録しました（送信待ち）' : '記録しました' }}
          </p>

          <div class="pop__actions">
            <button
              type="button"
              class="pop__button pop__button--primary"
              :disabled="saving || !canSave"
              @click="record"
            >
              記録する
            </button>
            <button type="button" class="pop__button" @click="openItem">
              TODOを開く →
            </button>
          </div>
        </template>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
/*
 * 広い画面では、押したリンクの近くに浮かせる（背景は暗くしない。日記を
 * 読みながら書き足すためのもので、画面を占有させない）。
 * 狭い画面では下端のシートにする（操作シートと同じ）。
 */
.overlay {
  position: fixed;
  inset: 0;
  z-index: 30;
}

.overlay--compact {
  background: rgb(0 0 0 / 45%);
  display: flex;
  align-items: flex-end;
  justify-content: center;
}

.pop {
  position: fixed;
  max-height: min(80vh, 30rem);
  overflow-y: auto;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  box-shadow: var(--shadow);
  padding: 0.75rem;
  display: grid;
  gap: 0.5rem;
  align-content: start;
}

.pop--compact {
  position: static;
  width: min(30rem, 100%);
  border-bottom: 0;
  border-radius: 16px 16px 0 0;
  padding-bottom: calc(0.75rem + env(safe-area-inset-bottom));
}

.pop__head {
  display: flex;
  align-items: flex-start;
  gap: 0.5rem;
}

.pop__title {
  flex: 1;
  min-width: 0;
  margin: 0;
  font-weight: 600;
  font-size: 0.9375rem;
  overflow-wrap: anywhere;
}

.pop__close {
  flex-shrink: 0;
  background: transparent;
  border: 0;
  color: var(--text-muted);
  font-size: 1.125rem;
  line-height: 1;
  padding: 0 0.25rem;
}

.pop__meta,
.pop__note {
  margin: 0;
  color: var(--text-muted);
  font-size: 0.8125rem;
  overflow-wrap: anywhere;
}

.pop__label {
  font-size: 0.8125rem;
  color: var(--text-muted);
}

.pop__input {
  width: 100%;
  box-sizing: border-box;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 8px;
  color: var(--text);
  padding: 0.5rem;
  /* iOS でフォーカス時に自動ズームされないよう 16px を保つ */
  font-size: 1rem;
  line-height: 1.6;
  resize: vertical;
}

.pop__actions {
  display: flex;
  gap: 0.5rem;
}

.pop__stack {
  display: grid;
  gap: 0.5rem;
}

.pop__button {
  flex: 1;
  min-height: 2.75rem;
  padding: 0 0.75rem;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: transparent;
  color: var(--text);
  font-size: 0.875rem;
}

.pop__button--primary {
  background: var(--accent);
  border-color: var(--accent);
  color: var(--accent-text);
  font-weight: 600;
}

.pop__button--wide {
  width: 100%;
}

.pop__button:disabled {
  opacity: 0.5;
}

.pop__error {
  margin: 0;
  color: var(--danger);
  font-size: 0.8125rem;
}

.pop__saved {
  margin: 0;
  color: var(--accent);
  font-size: 0.8125rem;
}

.choices {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: 0.375rem;
}

.choices__item {
  width: 100%;
  display: grid;
  gap: 0.125rem;
  text-align: left;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 8px;
  color: var(--text);
  min-height: 2.75rem;
  padding: 0.5rem 0.75rem;
}

.choices__title {
  font-size: 0.875rem;
  overflow-wrap: anywhere;
}

.choices__meta {
  color: var(--text-muted);
  font-size: 0.75rem;
}
</style>
