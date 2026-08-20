<script setup lang="ts">
import { TAG_COLORS, type TagColor } from '~~/shared/types/tag'

/**
 * タグ一覧（docs/09-tags.md 9.3）。
 *
 * どんなタグを使っているかを一覧で見て、そこから絞り込んだタスク一覧へ
 * 入るための入口。`g` `s` は特定のタグへ直接移れる別の入口
 * （app.vue の GoToTagDialog）を使う。
 */
const { tags, pending, colorOf, setColor } = useTags()

useHead({ title: 'タグ' })

/**
 * そのタグのタスク一覧へのリンク。
 *
 * status は「すべて」に合わせつつ、完了済みは除く（`open=true`）。
 * ここに出ている件数は status を問わず数えているため、完了済みが
 * 混じっていると一覧側の表示件数とは食い違って見えることがある。
 */
function to(name: string) {
  return { path: '/items', query: { status: 'all', open: 'true', tag: name } }
}

/** 色を選んでいるタグの id。同時に開くのは1つだけ。 */
const openColorId = ref<string | null>(null)

function toggleColorPicker(id: string) {
  openColorId.value = openColorId.value === id ? null : id
}

/** サーバーから取れていない（オフラインの手元集計）タグは id が本物でないため、色を変えられない。 */
function isLocalTag(id: string): boolean {
  return id.startsWith('local:')
}

async function pickColor(id: string, color: TagColor | null) {
  openColorId.value = null
  await setColor(id, color)
}
</script>

<template>
  <div class="page">
    <h1 class="page__title">タグ</h1>

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
                :style="{ '--tag-color': tagColorVar(tag.color) }"
                aria-hidden="true"
              />
              {{ tag.name }}
            </span>
            <span class="tags__count">{{ tag.count }}</span>
          </NuxtLink>
          <button
            v-if="!isLocalTag(tag.id)"
            type="button"
            class="tags__color-trigger"
            :aria-label="`「${tag.name}」の色を変更`"
            :aria-expanded="openColorId === tag.id"
            @click="toggleColorPicker(tag.id)"
          >
            <span :style="{ '--tag-color': tagColorVar(tag.color) }" class="tags__dot" aria-hidden="true" />
          </button>
        </div>

        <div v-if="openColorId === tag.id" class="tags__palette" role="group" :aria-label="`「${tag.name}」の色`">
          <button
            type="button"
            class="tags__swatch tags__swatch--none"
            :aria-pressed="tag.color === null"
            aria-label="色なし"
            @click="pickColor(tag.id, null)"
          >
            ×
          </button>
          <button
            v-for="color in TAG_COLORS"
            :key="color"
            type="button"
            class="tags__swatch"
            :style="{ '--tag-color': tagColorVar(color) }"
            :aria-pressed="colorOf(tag.name) === color"
            :aria-label="color"
            @click="pickColor(tag.id, color)"
          />
        </div>
      </li>
    </ul>

    <NuxtLink class="page__untagged" :to="{ path: '/items', query: { status: 'all', untagged: 'true' } }">
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

.tags__dot {
  width: 0.625rem;
  height: 0.625rem;
  border-radius: 999px;
  background: var(--tag-color);
  flex-shrink: 0;
}

.tags__count {
  color: var(--text-muted);
  font-size: 0.8125rem;
  font-variant-numeric: tabular-nums;
}

.tags__color-trigger {
  flex-shrink: 0;
  width: 2.75rem;
  height: 2.75rem;
  display: grid;
  place-items: center;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius);
}

.tags__color-trigger .tags__dot {
  width: 1rem;
  height: 1rem;
}

.tags__palette {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  padding: 0.625rem;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius);
}

.tags__swatch {
  width: 2rem;
  height: 2rem;
  border-radius: 999px;
  background: var(--tag-color);
  border: 2px solid transparent;
}

.tags__swatch[aria-pressed='true'] {
  border-color: var(--text);
}

.tags__swatch--none {
  background: var(--bg);
  border: 1px solid var(--border);
  color: var(--text-muted);
}

.page__untagged {
  color: var(--text-muted);
  font-size: 0.875rem;
}
</style>
