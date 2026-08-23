<script setup lang="ts">
import {
  LEGACY_TAG_COLORS,
  RTM_TAG_COLORS,
  TAG_NAME_MAX_LENGTH,
  normalizeTagName,
  type TagColor,
  type TagDto,
} from '~~/shared/types/tag'

/**
 * タグ一覧（docs/09-tags.md 9.3）。
 *
 * どんなタグを使っているかを一覧で見て、そこから絞り込んだタスク一覧へ
 * 入るための入口。`g` `s` は特定のタグへ直接移れる別の入口
 * （app.vue の GoToTagDialog）を使う。
 */
const { tags, pending, colorOf, setColor, rename } = useTags()

useHead({ title: 'タグ' })

/**
 * そのタグのタスク一覧へのリンク。行き先は未完了側なので完了済みは並ばない。
 *
 * 件数も同じく未完了のものだけを数えているので、押した先に並ぶ数と一致する。
 */
function to(name: string) {
  return { path: '/', query: { tag: name } }
}

/** 色を選んでいるタグの id。同時に開くのは1つだけ。 */
const openColorId = ref<string | null>(null)

function toggleColorPicker(id: string) {
  openColorId.value = openColorId.value === id ? null : id
  // 1行の下に2つ開くと、どちらのボタンの中身なのか読み取れない
  if (openColorId.value) renamingId.value = null
}

/** サーバーから取れていない（オフラインの手元集計）タグは id が本物でないため、色を変えられない。 */
function isLocalTag(id: string): boolean {
  return id.startsWith('local:')
}

/**
 * 色を選ぶ。押した時点で色は変わる（useTags の setColor）。
 * 送れなかったときだけ、元の色に戻ったことの理由を出す。
 */
const errorMessage = ref<string | null>(null)

async function pickColor(id: string, color: TagColor | null) {
  openColorId.value = null
  errorMessage.value = null

  try {
    await setColor(id, color)
  } catch {
    errorMessage.value = '色を変更できませんでした'
  }
}

// --- 名前の変更（docs/09-tags.md 9.3） ---------------------------------
//
// 表記ゆれを直すための操作。付いている全 Item に反映される。
// 行の下にその場で入力欄を開く。別の画面へ移ると、どのタグを直していたのかを
// 見失いやすいため。

/** 名前を変えているタグの id。同時に開くのは1つだけ。 */
const renamingId = ref<string | null>(null)
const renameInput = ref('')
const renameError = ref<string | null>(null)
const renaming = ref(false)

function startRename(tag: TagDto) {
  openColorId.value = null
  renamingId.value = tag.id
  renameInput.value = tag.name
  renameError.value = null
}

function cancelRename() {
  renamingId.value = null
  renameError.value = null
}

/**
 * 変更後の名前。使えない文字ならnull（サーバーと同じ正規化を通す）。
 */
const renameNormalized = computed(() => normalizeTagName(renameInput.value))

/**
 * 変更先にすでに別のタグがあるか。
 *
 * その場合はエラーにせず統合される（サーバーの挙動。9.2）。
 * 押す前に何が起きるか分かるよう、先に知らせる。
 */
const mergeTarget = computed(() => {
  const name = renameNormalized.value
  if (!name) return null
  return tags.value.find(
    (tag) => tag.name === name && tag.id !== renamingId.value,
  ) ?? null
})

async function submitRename(tag: TagDto) {
  const name = renameNormalized.value

  if (!name) {
    renameError.value = 'タグ名として使えません（空白・カンマ・# は使えません）'
    return
  }
  if (name === tag.name) {
    cancelRename()
    return
  }

  renaming.value = true
  renameError.value = null

  try {
    await rename(tag.id, name)
    renamingId.value = null
  } catch {
    // オフラインでも起こる。書き換えは送れていないので、入力はそのまま残す
    renameError.value = '名前を変更できませんでした'
  } finally {
    renaming.value = false
  }
}

/**
 * 色見本の並び。RTM と同じ 24 色（6 列 × 4 行）を先に出し、
 * それより前から使っている独自の色をその下に続ける。
 */
const colorGroups = [RTM_TAG_COLORS, LEGACY_TAG_COLORS] as const

function swatchStyle(color: TagColor) {
  return { '--tag-color': tagColorVar(color), '--tag-text': tagTextColorVar(color) }
}
</script>

<template>
  <div class="page">
    <h1 class="page__title">タグ</h1>

    <p v-if="errorMessage" class="page__error" role="alert">{{ errorMessage }}</p>

    <p v-if="pending && !tags.length" class="page__placeholder">読み込み中…</p>

    <p v-else-if="!tags.length" class="page__placeholder">
      タグはまだありません。タスクに <code>#タグ名</code> を付けるとここに並びます。
    </p>

    <ul v-else class="tags">
      <li v-for="tag in tags" :key="tag.id" class="tags__row">
        <div class="tags__main">
          <NuxtLink class="tags__item" :to="to(tag.name)">
            <span class="tags__name">
              <span
                class="tags__dot"
                :style="{
                  '--tag-color': tagColorVar(tag.color),
                  '--tag-text': tagTextColorVar(tag.color),
                }"
                aria-hidden="true"
              />
              {{ tag.name }}
            </span>
            <span class="tags__count">{{ tag.count }}</span>
          </NuxtLink>
          <!--
            オフラインの手元集計（id が local:）は、サーバーの行を指せないので
            名前も色も変えられない。
          -->
          <button
            v-if="!isLocalTag(tag.id)"
            type="button"
            class="tags__control"
            :aria-label="`「${tag.name}」の名前を変更`"
            :aria-expanded="renamingId === tag.id"
            @click="startRename(tag)"
          >
            <span aria-hidden="true">✎</span>
          </button>
          <button
            v-if="!isLocalTag(tag.id)"
            type="button"
            class="tags__control"
            :aria-label="`「${tag.name}」の色を変更`"
            :aria-expanded="openColorId === tag.id"
            @click="toggleColorPicker(tag.id)"
          >
            <span
              :style="{
                '--tag-color': tagColorVar(tag.color),
                '--tag-text': tagTextColorVar(tag.color),
              }"
              class="tags__dot"
              aria-hidden="true"
            />
          </button>
        </div>

        <!--
          名前の変更。付いている全 Item に反映されるので、押した先で
          何が起きるか（統合されるかどうか）を出してから確定させる。
        -->
        <form
          v-if="renamingId === tag.id"
          class="rename"
          @submit.prevent="submitRename(tag)"
        >
          <input
            v-model="renameInput"
            class="rename__input"
            type="text"
            :maxlength="TAG_NAME_MAX_LENGTH"
            :aria-label="`「${tag.name}」の新しい名前`"
            autocapitalize="off"
            autocomplete="off"
            spellcheck="false"
            @keydown.esc.prevent="cancelRename"
          >
          <div class="rename__actions">
            <button
              type="submit"
              class="rename__submit"
              :disabled="renaming || !renameNormalized"
            >
              変更
            </button>
            <button type="button" class="rename__cancel" @click="cancelRename">
              キャンセル
            </button>
          </div>
          <p v-if="renameError" class="rename__error" role="alert">
            {{ renameError }}
          </p>
          <p v-else-if="mergeTarget" class="rename__note">
            「{{ mergeTarget.name }}」がすでにあります。変更すると1つにまとまります。
          </p>
          <p v-else-if="renameInput && !renameNormalized" class="rename__note">
            空白・カンマ・# は使えません。
          </p>
          <p v-else class="rename__note">
            このタグが付いた{{ tag.count }}件すべてに反映されます。
          </p>
        </form>

        <div v-if="openColorId === tag.id" class="tags__palette" role="group" :aria-label="`「${tag.name}」の色`">
          <div v-for="(group, index) in colorGroups" :key="index" class="tags__grid">
            <button
              v-for="color in group"
              :key="color"
              type="button"
              class="tags__swatch"
              :style="swatchStyle(color)"
              :aria-pressed="colorOf(tag.name) === color"
              :aria-label="color"
              @click="pickColor(tag.id, color)"
            >
              <span v-if="colorOf(tag.name) === color" aria-hidden="true">✓</span>
            </button>
          </div>
          <button
            type="button"
            class="tags__swatch tags__swatch--none"
            :aria-pressed="tag.color === null"
            @click="pickColor(tag.id, null)"
          >
            色なし
          </button>
        </div>
      </li>
    </ul>

    <NuxtLink class="page__untagged" :to="{ path: '/', query: { untagged: 'true' } }">
      タグなしのタスクを見る
    </NuxtLink>
  </div>
</template>

<style scoped>
.page {
  display: grid;
  gap: 1rem;
}

.page__title {
  margin: 0;
  font-size: 1.25rem;
  font-weight: 700;
}

.page__placeholder {
  margin: 0;
  color: var(--text-muted);
  font-size: 0.9375rem;
}

.page__error {
  margin: 0;
  color: var(--danger);
  font-size: 0.875rem;
}

.tags {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: 0.375rem;
}

.tags__row {
  display: grid;
  gap: 0.375rem;
}

.tags__main {
  display: flex;
  align-items: center;
  gap: 0.375rem;
}

.tags__item {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  /* タップ目標として十分な大きさを確保する */
  min-height: 2.75rem;
  padding: 0 0.875rem;
  color: var(--text);
  text-decoration: none;
}

.tags__name {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  font-weight: 600;
  overflow-wrap: anywhere;
}

/*
 * 淡い色は背景に紛れて「色が付いていない」ように見えるので、
 * 対になっている濃い側の色で細い輪郭を付けて形が分かるようにする。
 */
.tags__dot {
  width: 0.625rem;
  height: 0.625rem;
  border-radius: 999px;
  background: var(--tag-color);
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--tag-text) 40%, transparent);
  flex-shrink: 0;
}

.tags__count {
  color: var(--text-muted);
  font-size: 0.8125rem;
  font-variant-numeric: tabular-nums;
}

/* 名前・色を変えるボタン。並べても押し間違えない大きさを確保する */
.tags__control {
  flex-shrink: 0;
  width: 2.75rem;
  height: 2.75rem;
  display: grid;
  place-items: center;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  color: var(--text-muted);
  font-size: 0.9375rem;
  line-height: 1;
}

.tags__control .tags__dot {
  width: 1rem;
  height: 1rem;
}

.rename {
  display: grid;
  gap: 0.5rem;
  padding: 0.625rem;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius);
}

.rename__input {
  width: 100%;
  min-height: 2.75rem;
  padding: 0 0.625rem;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 8px;
  color: var(--text);
  font: inherit;
}

.rename__actions {
  display: flex;
  gap: 0.5rem;
}

.rename__submit {
  min-height: 2.75rem;
  padding: 0 1.25rem;
  border: 0;
  border-radius: 8px;
  background: var(--accent);
  color: var(--accent-text);
  font-weight: 600;
}

.rename__submit:disabled {
  opacity: 0.5;
}

.rename__cancel {
  min-height: 2.75rem;
  padding: 0 0.75rem;
  border: 0;
  background: transparent;
  color: var(--text-muted);
}

/* 何が起きるかの説明。行の高さが変わって下の行が動かないよう、常に1つ出す */
.rename__note {
  margin: 0;
  color: var(--text-muted);
  font-size: 0.8125rem;
  line-height: 1.5;
}

.rename__error {
  margin: 0;
  color: var(--danger);
  font-size: 0.8125rem;
}

.tags__palette {
  display: grid;
  justify-items: start;
  gap: 0.75rem;
  padding: 0.625rem;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius);
}

/* RTM の色見本と同じ 6 列に並べる。狭い画面でも 6 列が入るよう最小幅で組む。 */
.tags__grid {
  display: grid;
  grid-template-columns: repeat(6, minmax(2rem, 2.75rem));
  gap: 0.5rem;
  width: 100%;
  max-width: 20rem;
}

.tags__swatch {
  aspect-ratio: 1;
  display: grid;
  place-items: center;
  border-radius: 999px;
  background: var(--tag-color);
  /* 淡い色でも輪郭が分かるように、対になっている濃い側の色で縁取る */
  border: 1px solid color-mix(in srgb, var(--tag-text) 40%, transparent);
  color: var(--tag-text);
  font-size: 0.875rem;
  font-weight: 700;
  line-height: 1;
}

/*
 * 選んでいる色はチェックで示す。淡い色も濃い色もあるので、枠線の色を
 * 変えるだけだと（--text と近い色のときに）区別が付かないため。
 */
.tags__swatch[aria-pressed='true'] {
  border-color: var(--text);
}

.tags__swatch--none {
  width: auto;
  aspect-ratio: auto;
  min-height: 2.25rem;
  padding: 0 0.875rem;
  border-radius: var(--radius);
  background: var(--bg);
  border: 1px solid var(--border);
  color: var(--text-muted);
  font-size: 0.8125rem;
  font-weight: 600;
}

.tags__swatch--none[aria-pressed='true'] {
  border-color: var(--text);
  color: var(--text);
}

.page__untagged {
  color: var(--text-muted);
  font-size: 0.875rem;
}
</style>
