<script setup lang="ts">
import { normalizeTagName } from '~~/shared/types/tag'
import {
  composeSmartAddInput,
  parseSmartAdd,
  type SmartAddOverrides,
} from '~~/shared/utils/smart-add'
import { splitInput } from '~~/shared/utils/text'

// 一覧の右側に詳細を並べるため、この画面だけコンテナを広く使う
definePageMeta({ wide: true })

const route = useRoute()

/**
 * 未完了のものだけに絞るか。`g` `s`（タグを選ぶダイアログ）からの
 * 行き先で使う。タグの絞り込みに完了済みが混ざると見づらいため。
 */
const openOnly = computed(() => route.query.open === 'true')

/** タグの絞り込み。一覧コンポーネント側も同じ query から持つ。 */
const tag = computed<string | undefined>(() => {
  const value = route.query.tag
  if (typeof value !== 'string') return undefined
  return normalizeTagName(value) ?? undefined
})

const listView = ref<{ create: (text: string) => Promise<boolean> } | null>(null)

useHead({ title: 'タスク' })

/**
 * タグで絞り込んでいる間の追加に既定を足す。
 *
 * - そのまま追加すると絞り込みから外れて一覧から消えてしまうため、
 *   見ているタグを自動で付ける
 * - 期限は書かなければ既定で「今日」になる（buildItemDraft）が、
 *   タグ一覧からの追加は「今日やること」に限らないため「なし」にする
 *
 * 明示的に書かれた指定（`#別タグ` や `^明日` など）は上書きしない。
 */
function applyTagDefaults(text: string): string {
  if (!tag.value) return text

  const split = splitInput(text)
  if (!split) return text
  const parsed = parseSmartAdd(split.titleLine)

  const overrides: SmartAddOverrides = {
    tags: [...new Set([...parsed.tags, tag.value])],
  }
  if (parsed.dueAt === null && !parsed.dueCleared) overrides.due = null

  return composeSmartAddInput(text, overrides)
}

async function add(text: string) {
  await listView.value?.create(applyTagDefaults(text))
}
</script>

<template>
  <div class="page">
    <header class="head">
      <h1 class="head__title">タスク</h1>
      <!-- list__bar（未完了/完了・並び・ヘルプ）をここへテレポートする。
           一覧側の別行にすると、その分だけ表示エリアが押し下がるため -->
      <div id="items-list-bar" class="head__bar" />
    </header>

    <ItemComposer
      :multiline="false"
      placeholder="タスクを追加（例: 請求書を出す ^明日 !1 #仕事）"
      @submit="add"
    />

    <!--
      進行状態での絞り込みは持たない。未着手と対応中を分けて見るより、
      未完了をひと続きで見るほうが実際の使い方に合うため
      （分けたいときはグループ順の「ステータス」で見出しを付ける）。
    -->
    <ItemListView
      ref="listView"
      status="all"
      storage-key="sort:items"
      show-sort
      :show-tag-filter="false"
      :open-only="openOnly"
      bar-target="#items-list-bar"
      empty-message="該当するタスクはありません。"
    />
  </div>
</template>

<style scoped>
.page {
  display: grid;
  gap: 1rem;
}

.head {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 0.625rem;
}

.head__title {
  margin: 0;
  font-size: 1.25rem;
  font-weight: 700;
}

.head__bar {
  /* list__bar（未完了/完了・並び・ヘルプ）がテレポートされてくる場所。
     残りの幅をここへ持たせ、タイトルの右側に並べる */
  flex: 1 1 auto;
  min-width: 0;
}
</style>
