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
 * 「リストに移動」（`g` `m`）。
 *
 * タグ（`g` `s`）と同じ形にする。スマートリスト
 * （docs/08-todo-management.md 8.6）を名前で選び、直接そのリストへ移る。
 */
const listSwitcherOpen = ref(false)

function goToSmartList(id: string) {
  listSwitcherOpen.value = false
  void navigateTo(`/lists/${id}`)
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

/**
 * 左袖（AppSidebar）。開いているあいだ、並べて置ける幅なら本文を右へ寄せる。
 * 狭い画面では本文に重ねて出すので、寄せない。
 */
const { open: sidebarOpen, docked: sidebarDocked, toggle: toggleSidebar } = useSidebar()

const shortcuts: Shortcut[] = [
  {
    keys: ['t'],
    label: 'タスクを追加',
    group: '追加',
    run: () => addTask(),
  },
  {
    /*
     * サイドバーの開閉。RTM の `;` に合わせる。単独キーの中では珍しく
     * 空いていて、押しやすい位置にある。
     */
    keys: [';'],
    label: 'サイドバーの開閉',
    group: 'その他',
    run: () => toggleSidebar(),
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
    keys: ['m'],
    label: 'リストに移動',
    group: '移動',
    run: () => {
      listSwitcherOpen.value = true
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
</script>

<template>
  <!--
    袖（AppSidebar）は画面に固定してあるので、並べて置ける幅で開いている間だけ、
    その分だけ本文を右へ寄せる（狭い画面では重ねて出すため寄せない）。
  -->
  <div class="layout" :class="{ 'layout--docked': sidebarOpen && sidebarDocked }">
    <AppSidebar />

    <div class="shell" :class="{ 'shell--wide': wide, 'shell--reading': reading }">
      <!--
        <link rel="manifest"> を出す（@vite-pwa/nuxt の部品）。モジュールを
        入れるだけでは出ないので、ここで置く。これが無いとブラウザは manifest を
        読まず、インストールできる条件を満たさない。Android の「ホーム画面に
        追加」が「ショートカットを作成」になり、共有先にも出てこない
        （docs/13-share-target.md 13.1）。
      -->
      <VitePwaManifest />

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
        袖を開く（`;` と同じ入り口）。キーボードの無い端末のために置く。
        画面の流れには入れない。1行ぶんの高さを取ると、区分の帯をやめて
        本文を上へ詰めた意味がなくなるため。開いている間は袖の中の ☰
        （AppSidebar）が同じ場所に出るので、こちらは消す。
      -->
      <button
        v-if="!sidebarOpen && !selectionCount"
        type="button"
        class="menu"
        aria-label="サイドバーの開閉"
        title="サイドバーの開閉（;）"
        @click="toggleSidebar"
      >
        <span aria-hidden="true">☰</span>
      </button>

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

      <GoToSmartListDialog
        v-if="listSwitcherOpen"
        @select="goToSmartList"
        @close="listSwitcherOpen = false"
      />

      <!--
        本文の画像の拡大表示（docs/11-scrapbox-notation.md 11.7）。
        どの画面の画像からも同じものを使うので、ここに1つだけ置く。
      -->
      <ImageViewer />
    </div>
  </div>
</template>

<style scoped>
/*
 * 袖（AppSidebar）は画面に固定しているので、本文はその下へ潜り込む。
 * 並べて置ける幅で開いている間だけ、袖の幅ぶん左を空けて避ける。
 *
 * 狭い画面では避けない。避けると本文が画面の外へはみ出し、袖を閉じた
 * あとも横スクロールが残る。重ねて出し、背景を押せば閉じる（AppSidebar）。
 */
.layout {
  transition: padding-left 0.18s ease;
}

@media (min-width: 60rem) {
  /* 閉じている間、左上の ☰ が本文に重ならないように空けておく */
  .layout {
    padding-left: 3rem;
  }

  .layout--docked {
    padding-left: var(--sidebar-width);
  }
}

@media (prefers-reduced-motion: reduce) {
  .layout {
    transition: none;
  }
}

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

/*
 * 袖を開くボタン。
 *
 * 狭い画面では「＋」と対にして**左下**に浮かべる。上に置くと画面の見出し
 * （「タスク」「未完了 / 完了」）と重なり、避けるために左を空けると、
 * ただでさえ狭い一覧がさらに細くなる。下端なら縦も横も取らず、片手で届く。
 */
.menu {
  position: fixed;
  left: calc(1rem + env(safe-area-inset-left));
  bottom: calc(1rem + env(safe-area-inset-bottom));
  z-index: 10;
  width: 3.5rem;
  height: 3.5rem;
  display: grid;
  place-items: center;
  padding: 0;
  border: 1px solid var(--border);
  border-radius: 999px;
  background: var(--surface);
  color: var(--text);
  box-shadow: 0 4px 12px rgb(0 0 0 / 25%);
  font-size: 1.25rem;
  line-height: 1;
}

.menu:active {
  transform: scale(0.96);
}

/*
 * 並べて置ける幅では左上に戻す。袖を開いたときの ☰（AppSidebar の .fold）と
 * 同じ場所なので、開け閉めしてもボタンが飛ばない。重ならないよう、
 * その幅ぶんは本文の左を空ける（.layout）。
 */
@media (min-width: 60rem) {
  .menu {
    top: calc(0.75rem + env(safe-area-inset-top));
    left: calc(0.625rem + env(safe-area-inset-left));
    bottom: auto;
    width: 2rem;
    height: 2rem;
    box-shadow: none;
    color: var(--text-muted);
    font-size: 0.9375rem;
  }

  .menu:hover {
    color: var(--text);
  }
}

.shell__sync {
  padding-bottom: 0.5rem;
}

</style>
