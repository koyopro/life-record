<script setup lang="ts">
import type { SectionDto } from '~~/shared/types/item'
import { formatAppDate, isAppDate } from '~~/shared/utils/date'

/**
 * 過去の作業記録を1件出す（docs/03-functional-spec.md 3.2）。
 *
 * 当日の枠と違い、**既定は確定済みの見た目**で、書ける状態にはしない。
 * 読み返すためのものが入力欄の見た目で並んでいると、どれが今日書く欄なのか
 * 分からなくなるため。直したいときだけ編集アイコンで開く。
 */
const props = defineProps<{
  /** この記録が属する Item。ストアを引くのに要る。 */
  itemId: string
  section: SectionDto
  /** 同じ日付の中で、上下に動かせるか。 */
  canMoveUp?: boolean
  canMoveDown?: boolean
}>()

const emit = defineEmits<{
  changeDate: [date: string]
  move: [delta: -1 | 1]
  remove: []
}>()

const store = useItemDetailStore()

/*
 * 下書きを画面側に持たない。打鍵はそのままストアへ渡し、送信はストアが
 * 遅らせて裏で行う（docs/15-client-state.md）。持たないので、
 * 「編集中はサーバーの内容で上書きしない」という手当ても要らない。
 */
const body = computed({
  get: () => store.sectionBodyOf(props.itemId, props.section.id),
  set: (value: string) => store.editSectionBody(props.itemId, props.section.id, value),
})

const save = computed(() => store.sectionStatus(props.itemId, props.section.id))

const dateLabel = computed(() => formatAppDate(props.section.date))

/** 中身を隠せるようにする。日をまたぐ記録が増えると、当日の枠が下へ遠のくため。 */
const open = ref(true)

/** 編集アイコンで開く。開くまでは日付も並べ替えも動かせない。 */
const editing = ref(false)

function toggleEditing() {
  editing.value = !editing.value
  // 畳んだまま編集に入ると、書く場所が見えない
  if (editing.value) open.value = true
}

// 別の記録を指すようになったら、開きかけの編集は持ち越さない
watch(
  () => props.section.id,
  () => {
    editing.value = false
    open.value = true
  },
)

/**
 * 日付を変える。
 *
 * 入力途中（`2026-0` など）や、消したところで発火するので、
 * 日付として成立していないうちは送らない。
 */
function onDateInput(event: Event) {
  const value = (event.target as HTMLInputElement).value
  if (!isAppDate(value) || value === props.section.date) return
  emit('changeDate', value)
}

const editor = ref<{ focus: () => void } | null>(null)

defineExpose({
  focus: () => {
    editing.value = true
    open.value = true
    void nextTick(() => editor.value?.focus())
  },
})
</script>

<template>
  <article class="record" :class="{ 'record--editing': editing }">
    <header class="record__head">
      <!-- いつの記録かは畳んでいても分かるよう、トグル自体に日付を載せる -->
      <button
        type="button"
        class="record__toggle"
        :aria-expanded="open"
        :aria-label="`${dateLabel} の作業記録を${open ? '隠す' : '表示する'}`"
        @click="open = !open"
      >
        <span class="record__caret" aria-hidden="true">{{ open ? '▾' : '▸' }}</span>
        <span class="record__date">{{ dateLabel }}</span>
      </button>

      <!--
        日付は編集中だけ直せるようにする。作業した日を後から書き足す
        ことがあるため（docs/03-functional-spec.md 3.2）。
      -->
      <input
        v-if="editing"
        class="record__date-input"
        type="date"
        :value="section.date"
        :aria-label="`${dateLabel} の作業記録の日付`"
        @change="onDateInput"
      />

      <!--
        その日の日記へ。Section と Diary は日付だけで結び付く
        （docs/02-data-model.md 2.7）。
      -->
      <NuxtLink
        class="record__diary"
        :to="`/diary/${section.date}`"
        :aria-label="`${dateLabel} の日記を開く`"
      >
        日記
      </NuxtLink>

      <span class="record__save">
        <SaveDot v-if="editing" :state="save.state" />
      </span>

      <button
        type="button"
        class="record__button"
        :aria-label="`${dateLabel} の作業記録を${editing ? '読むだけにする' : '編集する'}`"
        :aria-pressed="editing"
        @click="toggleEditing"
      >
        <span aria-hidden="true">{{ editing ? '完了' : '✎' }}</span>
      </button>

      <template v-if="editing">
        <button
          v-if="canMoveUp"
          type="button"
          class="record__button"
          :aria-label="`${dateLabel} の作業記録を上へ`"
          @click="emit('move', -1)"
        >
          ↑
        </button>
        <button
          v-if="canMoveDown"
          type="button"
          class="record__button"
          :aria-label="`${dateLabel} の作業記録を下へ`"
          @click="emit('move', 1)"
        >
          ↓
        </button>
        <button
          type="button"
          class="record__button record__button--danger"
          :aria-label="`${dateLabel} の作業記録を削除`"
          @click="emit('remove')"
        >
          削除
        </button>
      </template>
    </header>

    <template v-if="open">
      <ScrapboxEditor
        v-if="editing"
        ref="editor"
        v-model="body"
        :aria-label="`${dateLabel} の作業記録`"
        placeholder="この日にやったこと"
      />
      <!-- 読むだけの間は確定済みの見た目にする（入力欄には見せない） -->
      <ScrapboxEditor
        v-else
        view
        :model-value="section.body"
        :aria-label="`${dateLabel} の作業記録`"
      />
    </template>

    <p v-if="save.error" class="record__error" role="alert">
      {{ save.error }}
    </p>
  </article>
</template>

<style scoped>
.record {
  display: grid;
  gap: 0.375rem;
}

/* 編集中はどこを書いているのか分かるよう、枠で囲って浮かせる */
.record--editing {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 0.5rem;
}

.record__head {
  display: flex;
  align-items: center;
  gap: 0.375rem;
}

.record__toggle {
  display: flex;
  align-items: center;
  gap: 0.25rem;
  background: transparent;
  border: 0;
  padding: 0.125rem 0.25rem;
  color: var(--text);
  font: inherit;
  font-size: 0.8125rem;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  cursor: pointer;
}

.record__caret {
  color: var(--text-muted);
  font-size: 0.6875rem;
  width: 0.75rem;
}

.record__date-input {
  font: inherit;
  font-size: 0.8125rem;
  font-variant-numeric: tabular-nums;
  background: transparent;
  border: 1px solid var(--border);
  border-radius: 6px;
  color: var(--text);
  padding: 0.125rem 0.25rem;
}

.record__diary {
  color: var(--text-muted);
  text-decoration: none;
  font-size: 0.75rem;
  border: 1px solid var(--border);
  border-radius: 999px;
  padding: 0.0625rem 0.5rem;
}

.record__save {
  flex: 1;
}

.record__button {
  background: transparent;
  border: 0;
  color: var(--text-muted);
  font-size: 0.8125rem;
  min-height: 2.25rem;
  padding: 0 0.375rem;
}

.record__button--danger {
  color: var(--danger);
}

.record__error {
  margin: 0;
  color: var(--danger);
  font-size: 0.8125rem;
}
</style>
