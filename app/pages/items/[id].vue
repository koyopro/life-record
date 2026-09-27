<script setup lang="ts">
/**
 * 単体の詳細画面。
 *
 * 画面が広いときは一覧の右側に詳細を並べる（`/items`）ため、
 * こちらは狭い画面からの遷移と、URL 直接指定・共有のための入口。
 *
 * 幅は日記と同じ「長文」の扱いにする。作業記録は日記と同じくらいの
 * 分量を書くので、既定の 40rem では PC で入力欄が狭い。分割表示の
 * 詳細（76rem から一覧の 22rem を引いた残り）ともおおむね揃う。
 */
definePageMeta({ wide: 'reading' })

const route = useRoute()
const id = computed(() => String(route.params.id))

/*
 * 題はそのタスクの名前にする。ブラウザのタブ・履歴・共有先で、どのタスクを
 * 開いているのかが分かるようにするため（macOS アプリのタブの見出しも
 * これを使う。docs/16-macos-app.md 16.10）。
 *
 * 手元に無い（まだ取れていない）間は、種類だけを出す。
 */
const store = useItemStore()
const item = computed(() => store.byId(id.value))

useHead({ title: () => item.value?.title || 'タスク' })

/*
 * 一覧と同じショートカット（`c` / `d` / `u` …）を、開いているこの1件に
 * 効かせる（docs/08-todo-management.md 8.4）。検索結果と同じく、出す Item を
 * id で直に渡し、カーソルは常にこの1件に置く。操作は一覧と同じ道具が
 * そのまま働く（取り消しの `z` も一覧と共通）。
 */
const list = useItemList({
  status: 'all',
  external: { ids: () => [id.value], focusedId: id },
})

const detail = ref<{
  focusTitle: () => void
  focusUrl: () => void | Promise<void>
  focusBody: () => void
  focusNote: () => void | Promise<void>
} | null>(null)

/** 詳細の欄へ移る（`r` / `u` / `y` / `m`）。この画面にある欄へそのまま入る。 */
async function focusDetail(field: 'Title' | 'Url' | 'Body' | 'Note') {
  await detail.value?.[`focus${field}`]()
}

const listOrigin = useListOrigin()

/*
 * 操作の結果（「URL を2件開いた」「取り消した」など）の知らせ。
 *
 * 一覧では見出しの横に出しているが、この画面には置き場所がないので
 * 下端に出し、しばらくしたら消す。
 */
const NOTICE_MS = 2500
let noticeTimer: ReturnType<typeof setTimeout> | undefined

watch(list.message, (text) => {
  clearTimeout(noticeTimer)
  if (!text) return
  noticeTimer = setTimeout(() => {
    if (list.message.value === text) list.message.value = null
  }, NOTICE_MS)
})

onUnmounted(() => clearTimeout(noticeTimer))
</script>

<template>
  <ItemDetail ref="detail" :item-id="id" />

  <p v-if="list.message.value" class="notice" role="status">
    {{ list.message.value }}
  </p>

  <!--
    タスクへの操作（一覧・検索結果と同じ部品）。一覧にしか意味のない
    割り当て（選択・切り替え）は `single` で外す。
  -->
  <ItemActions
    :list="list"
    :completed="item?.status === 'closed'"
    single
    :open="() => {}"
    :focus-detail="focusDetail"
    @removed="navigateTo(listOrigin)"
  />
</template>

<style scoped>
/* 選択中の帯（SelectionBar）と同じ位置・重なり順 */
.notice {
  position: fixed;
  left: 0.5rem;
  right: 0.5rem;
  bottom: calc(0.5rem + env(safe-area-inset-bottom));
  z-index: 15;
  margin: 0 auto;
  max-width: 32rem;
  width: fit-content;
  padding: 0.375rem 0.75rem;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 0.5rem;
  color: var(--text-muted);
  font-size: 0.875rem;
}
</style>
