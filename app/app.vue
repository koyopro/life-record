<script setup lang="ts">
import type { Shortcut } from '~/composables/useShortcuts'

const route = useRoute()

/**
 * 「今日」。開いたまま日付をまたいでも、行き先が前日のままにならない。
 */
const today = useToday()

/*
 * 本文の `:name:` を画像にするための対応表を、アプリの起動時に取っておく
 * （docs/11-scrapbox-notation.md 11.8）。
 *
 * 本文エディタは日記や詳細を読み込んだあとに現れるので、そちらの setup から
 * 取りに行くと初回の描画に間に合わない（ハイドレーションの後に作られる
 * コンポーネントの useFetch はその場では走らない）。どの画面にもある
 * ここで1回だけ取る。
 */
useIcons()

/** 今日の日記（「日記」タブと `g` `d` の行き先）。 */
const todayDiary = computed(() => `/diary/${today.value}`)

function goToTodayDiary() {
  return navigateTo(todayDiary.value)
}

/**
 * 分割表示を使う画面は、既定の読みやすい幅（40rem）では狭すぎるため広げる。
 * 画面側が `definePageMeta({ wide: true })` で申告する。
 *
 * `wide: 'reading'` は分割はしないが長文を読み書きする画面向け
 * （日記など）。Scrapbox の本文表示幅（862px ≒ 53.875rem）に合わせる。
 */
const wide = computed(() => route.meta.wide === true)
const reading = computed(() => route.meta.wide === 'reading')

/*
 * 「日記」は**その日の日記**へ入れる。日記は開いて書くものなので、
 * カレンダー（`/diary`）を経由させると必ず1タップ余分になる。
 * 別の日を選ぶときだけ、日記の画面のカレンダーボタンから移る。
 */
const NAV = computed(() => [
  { to: '/today', label: '今日', match: '/today' },
  { to: '/', label: 'タスク', match: '/' },
  { to: '/tags', label: 'タグ', match: '/tags' },
  { to: '/icons', label: 'アイコン', match: '/icons' },
  { to: todayDiary.value, label: '日記', match: '/diary' },
  { to: '/search', label: '検索', match: '/search' },
])

// --- 画面をまたぐショートカット（docs/08-todo-management.md 8.4） ---------
//
// 一覧の操作は ItemListView が持つが、追加と移動はどの画面からでも
// 効いてほしいのでここに置く。RTM の `t` / `g` に合わせる。

const composerFocus = provideComposer()

/**
 * 「タグに移動」（`g s`）。
 *
 * RTM に合わせ、タグ一覧のページへ送るのではなく、その場で選んで
 * 直接そのタグのタスク一覧（`/?tag=...`）へ移れるようにする。
 */
const tagSwitcherOpen = ref(false)

function goToTag(name: string) {
  tagSwitcherOpen.value = false
  void navigateTo({ path: '/', query: { tag: name } })
}

/**
 * タスクを追加する（`t`）。
 *
 * 入力欄のある画面ではそこへ移る。ない画面（日記・検索・詳細）からは、
 * タスク一覧へ移ってから入力欄へ移る。
 */
async function addTask() {
  if (composerFocus.value) {
    composerFocus.value()
    return
  }
  await navigateTo('/')
  const focus = await composerReady()
  focus?.()
}

/**
 * 入力欄が現れるまで待つ。
 *
 * 画面を移ってすぐには描画されていない。一覧の取得を待つあいだ
 * ページごと出ないため、その場で呼んでも間に合わない。
 */
function composerReady(): Promise<(() => void) | null> {
  if (composerFocus.value) return Promise.resolve(composerFocus.value)

  return new Promise((resolve) => {
    const stop = watch(composerFocus, (focus) => {
      if (!focus) return
      stop()
      clearTimeout(timer)
      resolve(focus)
    })
    // 現れないまま待ち続けても意味がないのであきらめる
    const timer = setTimeout(() => {
      stop()
      resolve(null)
    }, 3000)
  })
}

/*
 * チェックしたタスクの操作は下端の帯（SelectionBar）で行う。同じ場所を
 * 「＋」が占めてしまうので、選択中は退ける。
 *
 * 幅の判定と違って初期値（0件）はサーバー描画と食い違わないため、
 * CSS ではなく v-if で消してよい。
 */
const selectionCount = useSelectionCount()

const shortcuts: Shortcut[] = [
  {
    keys: ['t'],
    label: 'タスクを追加',
    group: '追加',
    run: () => addTask(),
  },
  {
    prefix: 'g',
    keys: ['t'],
    label: '今日へ移動',
    group: '移動',
    run: () => void navigateTo('/today'),
  },
  {
    prefix: 'g',
    keys: ['s'],
    label: 'タグに移動',
    group: '移動',
    run: () => {
      tagSwitcherOpen.value = true
    },
  },
  {
    prefix: 'g',
    keys: ['i'],
    label: 'タスク一覧へ移動',
    group: '移動',
    run: () => void navigateTo('/'),
  },
  {
    prefix: 'g',
    keys: ['d'],
    label: '今日の日記へ移動',
    group: '移動',
    run: () => void goToTodayDiary(),
  },
]

useShortcuts(shortcuts)

/**
 * いまどの区分にいるか。
 *
 * `router-link-active` に任せられない。タスク一覧（`/`）と詳細
 * （`/items/:id`）は Nuxt では親子ではなく別々のルートなので、
 * 詳細画面にいるときに一覧のリンクが active にならない。
 */
function isActive(to: string): boolean {
  // 詳細はタスク一覧の下にあるものとして扱う
  if (to === '/') return route.path === '/' || route.path.startsWith('/items')
  return route.path === to || route.path.startsWith(`${to}/`)
}
</script>

<template>
  <div class="shell" :class="{ 'shell--wide': wide, 'shell--reading': reading }">
    <!--
      <link rel="manifest"> を出す（@vite-pwa/nuxt の部品）。モジュールを
      入れるだけでは出ないので、ここで置く。これが無いとブラウザは manifest を
      読まず、インストールできる条件を満たさない。Android の「ホーム画面に
      追加」が「ショートカットを作成」になり、共有先にも出てこない
      （docs/13-share-target.md 13.1）。
    -->
    <VitePwaManifest />

    <header class="shell__header">
      <nav class="nav">
        <NuxtLink
          v-for="entry in NAV"
          :key="entry.match"
          :to="entry.to"
          class="nav__link"
          :class="{ 'nav__link--active': isActive(entry.match) }"
        >
          {{ entry.label }}
        </NuxtLink>
      </nav>
      <ThemeToggle />
    </header>
    <!--
      オフライン・未同期の知らせ。出すものが無ければ何も描かない。
      ブラウザの状態を見るので、サーバー描画とは食い違う。
    -->
    <ClientOnly>
      <SyncStatus class="shell__sync" />
    </ClientOnly>
    <main class="shell__main">
      <NuxtPage />
    </main>

    <!--
      タスクを追加する（`t` と同じ入り口）。狭い画面ではキーボードが
      使えないので、どの画面からでも押せる場所に置く。入力欄のない画面
      （日記・検索・詳細）からはタスク一覧へ移ってから開く。
    -->
    <button
      v-if="!selectionCount"
      type="button"
      class="add"
      aria-label="タスクを追加"
      @click="addTask"
    >
      <span aria-hidden="true">＋</span>
    </button>

    <GoToTagDialog
      v-if="tagSwitcherOpen"
      @select="goToTag"
      @close="tagSwitcherOpen = false"
    />
  </div>
</template>

<style scoped>
.shell {
  /* スマートフォンでの片手操作を基準に、幅は読みやすい範囲に留める */
  max-width: 40rem;
  margin: 0 auto;
  padding: 0.75rem 1rem 4rem;
}

/* 右下のボタンが一覧の最後を覆わないように、その分だけ下を空ける */
@media (max-width: 40rem) {
  .shell {
    padding-bottom: 6rem;
  }
}

/*
 * タスクを追加するボタン。狭い画面だけに出す。
 *
 * 出す・出さないは CSS で決める。幅の判定はハイドレーションのあとなので、
 * v-if にすると最初の描画に間に合わない。
 * 片手で押せる右下に固定する。シート（z-index 20）より下に置く。
 */
.add {
  display: none;
  position: fixed;
  right: 1rem;
  bottom: calc(1rem + env(safe-area-inset-bottom));
  z-index: 10;
  width: 3.5rem;
  height: 3.5rem;
  border: 0;
  border-radius: 999px;
  background: var(--accent);
  color: var(--accent-text);
  box-shadow: 0 4px 12px rgb(0 0 0 / 25%);
  font-size: 1.5rem;
  line-height: 1;
  place-items: center;
}

@media (max-width: 40rem) {
  .add {
    display: grid;
  }
}

.add:active {
  transform: scale(0.96);
}

/* 一覧と詳細を並べる画面だけ、必要な幅まで広げる */
.shell--wide {
  max-width: 76rem;
}

/* 長文を読み書きする画面（日記など）。Scrapbox の本文幅に合わせる */
.shell--reading {
  max-width: 53.875rem;
}

.shell__header {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding-bottom: 0.75rem;
}

.shell__sync {
  padding-bottom: 0.5rem;
}

/*
 * 区分の並び。数が増えても1行に収める。
 *
 * 折り返すと、狭い端末（360px）でヘッダーだけで2行ぶんの高さを取る。
 * 入りきらないぶんは横に流し、テーマの切り替えは右端に残す。
 */
.nav {
  display: flex;
  gap: 0.875rem;
  flex: 1;
  min-width: 0;
  overflow-x: auto;
  scrollbar-width: none;
}

.nav::-webkit-scrollbar {
  display: none;
}

.nav__link {
  color: var(--text-muted);
  white-space: nowrap;
  text-decoration: none;
  font-weight: 600;
  font-size: 0.9375rem;
  padding: 0.25rem 0;
  border-bottom: 2px solid transparent;
}

.nav__link--active {
  color: var(--text);
  border-bottom-color: var(--accent);
}
</style>
