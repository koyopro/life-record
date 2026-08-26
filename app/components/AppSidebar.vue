<script setup lang="ts">
import { formatAppDateShort, shiftAppDate } from '~~/shared/utils/date'
import { countSmartList } from '~/utils/smart-list-count'
import { tagColorVar } from '~/utils/tag-color'

/**
 * 左袖のナビゲーション（RTM の左側に合わせる）。
 *
 * **画面を移る入口はここだけ**にする。以前は上に区分の帯を置いていたが、
 * 袖と同じ行き先を2か所に持つことになり、狭い画面では帯と画面の見出しで
 * 2行が埋まっていた。帯をやめたぶん、本文が上に詰まる。
 *
 * リスト・タグ・日記は中身まで出しておき、一覧 → 一覧の移動を1押しで
 * 済ませる。
 *
 * 開閉は `;` とハンバーガー（app.vue）。広い画面（60rem 以上）では本文の
 * 横に並べ、狭い画面では本文に重ねて出す（useSidebar）。
 */
const { open, docked, dragX, close, toggle, isCollapsed, toggleSection } = useSidebar()

const route = useRoute()
const today = useToday()
const { lists } = useSmartLists()
const { tags } = useTags()
const itemStore = useItemStore()

/**
 * リストごとの件数。タグと同じく、押した先に並ぶ数を添える。
 *
 * サーバーに数えさせず、手元の Item（＝一覧を作っているのと同じ元）から
 * 数える。オフラインでも数字と中身がずれない（app/utils/smart-list-count.ts）。
 */
const listCounts = computed(
  () => new Map(lists.value.map((list) => [list.id, countSmartList(itemStore.items.value, list)])),
)

/** 日記に出す日数。当日を含めて数える。 */
const DIARY_DAYS = 5

/**
 * 直近の日記（4日前 → 当日）。
 *
 * 開いたまま日付をまたいでも `useToday` が切り替わるので、翌日は
 * その日を末尾にした5日分になる。
 */
const diaryDays = computed(() => {
  const days = []
  for (let back = DIARY_DAYS - 1; back >= 0; back--) {
    const date = shiftAppDate(today.value, -back)
    days.push({ date, label: formatAppDateShort(date), isToday: back === 0 })
  }
  return days
})

/**
 * いまどこを見ているか。
 *
 * タスク一覧はタグの絞り込み（`/?tag=...`）と URL を共有しているので、
 * パスだけでは「全てのタスク」と個々のタグを見分けられない。
 */
const currentTag = computed(() =>
  typeof route.query.tag === 'string' ? route.query.tag : null,
)

const isAllTasks = computed(
  () => (route.path === '/' && !currentTag.value) || route.path.startsWith('/items'),
)

const nav = ref<HTMLElement | null>(null)
const aside = ref<HTMLElement | null>(null)

/**
 * 端からのスワイプ（useSidebarSwipe）で、いまどこまで引かれているか
 * （0 = 閉じたところ、1 = 開ききったところ）。触れていなければ null。
 *
 * 幅は袖そのものから測る。閉じている間も画面の外にあるだけで大きさは
 * 持っているので、いつでも読める。CSS 側（--sidebar-width）と二重に
 * 持たずに済む。
 */
const dragProgress = computed(() => {
  if (dragX.value === null) return null
  const width = aside.value?.offsetWidth
  if (!width) return null
  return Math.min(1, dragX.value / width)
})

/*
 * 引いている間だけ、指の位置をそのまま袖の位置にする。指に追わせている
 * あいだに時間差（transition）を挟むと、遅れて付いてくるように見える。
 *
 * 離すと null に戻り、そこから既定の transition で開き（閉じ）きる。
 */
const dragStyle = computed(() => {
  if (dragProgress.value === null) return undefined
  return {
    transform: `translateX(${(dragProgress.value - 1) * 100}%)`,
    transition: 'none',
  }
})

/*
 * 重ねて出しているときは、行き先へ移ったら閉じる。開いたままだと、
 * 押した先の一覧が袖の下に隠れたままになる。
 */
watch(
  () => route.fullPath,
  () => {
    if (!docked.value) close()
  },
)

/*
 * 重ねて出したときは袖そのものへフォーカスを移す。`;` で開いたあと、
 * Esc で閉じられる（フォーカスが外にあると、一覧の Esc に取られる）。
 */
watch(open, async (value) => {
  if (!value || docked.value) return
  await nextTick()
  nav.value?.focus({ preventScroll: true })
})
</script>

<template>
  <!--
    重ねて出しているときの背景。押せば閉じる。並べて置ける幅では
    本文を覆っていないので出さない。

    端から引いている間も、引いた分だけ濃くする。袖が半分出ているのに
    背景が出そろっていると、指を戻しても閉じられないように見える。
  -->
  <div
    v-if="!docked && (open || dragProgress !== null)"
    class="scrim"
    :style="dragProgress !== null ? { opacity: dragProgress, transition: 'none' } : undefined"
    @click="close"
  />

  <aside ref="aside" class="sidebar" :class="{ 'sidebar--open': open }" :style="dragStyle">
    <!--
      閉じているあいだは画面の外にあるだけなので、Tab では入れないように
      する（見えないものへフォーカスが移ると、どこにいるのか分からなくなる）。
    -->
    <nav
      ref="nav"
      class="sidebar__nav"
      aria-label="サイドバー"
      tabindex="-1"
      :inert="!open || undefined"
      @keydown.esc.prevent="close"
    >
      <!--
        閉じるボタン。開くときに押した ☰（app.vue）と同じ場所に出す。
        押した指がそのまま次に触れる場所なので、動かさない。
      -->
      <button
        type="button"
        class="fold"
        aria-label="サイドバーの開閉"
        title="サイドバーの開閉（;）"
        @click="toggle"
      >
        <span aria-hidden="true">☰</span>
      </button>

      <NuxtLink class="item item--top" :class="{ 'item--active': isAllTasks }" to="/">
        全てのタスク
      </NuxtLink>

      <NuxtLink
        class="item item--top"
        :class="{ 'item--active': route.path === '/today' }"
        to="/today"
      >
        今日
      </NuxtLink>

      <NuxtLink
        class="item item--top"
        :class="{ 'item--active': route.path === '/search' }"
        to="/search"
      >
        検索
      </NuxtLink>

      <!-- 日記。当日を末尾にした直近5日ぶんを並べる -->
      <section class="group">
        <div class="group__head">
          <button
            type="button"
            class="group__fold"
            :aria-expanded="!isCollapsed('diary')"
            aria-label="日記の開閉"
            @click="toggleSection('diary')"
          >
            <span aria-hidden="true">{{ isCollapsed('diary') ? '▸' : '▾' }}</span>
          </button>
          <NuxtLink
            class="item item--head"
            :class="{ 'item--active': route.path.startsWith('/diary') }"
            :to="`/diary/${today}`"
          >
            日記
          </NuxtLink>
        </div>

        <ul v-if="!isCollapsed('diary')" class="group__items">
          <li v-for="day in diaryDays" :key="day.date">
            <NuxtLink
              class="item item--child"
              :class="{ 'item--active': route.path === `/diary/${day.date}` }"
              :to="`/diary/${day.date}`"
            >
              <span class="item__label">{{ day.label }}</span>
              <span v-if="day.isToday" class="item__note">今日</span>
            </NuxtLink>
          </li>
        </ul>
      </section>

      <!-- スマートリスト（docs/08-todo-management.md 8.6） -->
      <section class="group">
        <div class="group__head">
          <button
            type="button"
            class="group__fold"
            :aria-expanded="!isCollapsed('lists')"
            aria-label="リストの開閉"
            @click="toggleSection('lists')"
          >
            <span aria-hidden="true">{{ isCollapsed('lists') ? '▸' : '▾' }}</span>
          </button>
          <NuxtLink
            class="item item--head"
            :class="{ 'item--active': route.path === '/lists' }"
            to="/lists"
          >
            リスト
          </NuxtLink>
        </div>

        <ul v-if="!isCollapsed('lists')" class="group__items">
          <li v-for="list in lists" :key="list.id">
            <NuxtLink
              class="item item--child"
              :class="{ 'item--active': route.path === `/lists/${list.id}` }"
              :to="`/lists/${list.id}`"
            >
              <span class="item__label">{{ list.name }}</span>
              <span class="item__note">{{ listCounts.get(list.id) ?? 0 }}</span>
            </NuxtLink>
          </li>
          <li v-if="!lists.length" class="group__empty">リストはまだありません</li>
        </ul>
      </section>

      <!-- タグ（docs/09-tags.md 9.3）。押すとそのタグで絞ったタスク一覧へ -->
      <section class="group">
        <div class="group__head">
          <button
            type="button"
            class="group__fold"
            :aria-expanded="!isCollapsed('tags')"
            aria-label="タグの開閉"
            @click="toggleSection('tags')"
          >
            <span aria-hidden="true">{{ isCollapsed('tags') ? '▸' : '▾' }}</span>
          </button>
          <NuxtLink
            class="item item--head"
            :class="{ 'item--active': route.path === '/tags' }"
            to="/tags"
          >
            タグ
          </NuxtLink>
        </div>

        <ul v-if="!isCollapsed('tags')" class="group__items">
          <li v-for="tag in tags" :key="tag.id">
            <NuxtLink
              class="item item--child"
              :class="{ 'item--active': currentTag === tag.name }"
              :to="{ path: '/', query: { tag: tag.name } }"
            >
              <span
                class="item__dot"
                aria-hidden="true"
                :style="{ background: tagColorVar(tag.color) }"
              />
              <span class="item__label">{{ tag.name }}</span>
              <span class="item__note">{{ tag.count }}</span>
            </NuxtLink>
          </li>
          <li v-if="!tags.length" class="group__empty">タグはまだありません</li>
        </ul>
      </section>

      <!--
        下の段。毎日押すものではない持ち物（アイコンの管理・表示テーマ）を
        置く。タグが増えても押せるよう、袖の下端に貼り付ける。
      -->
      <footer class="foot">
        <NuxtLink
          class="item foot__link"
          :class="{ 'item--active': route.path === '/icons' }"
          to="/icons"
        >
          アイコン
        </NuxtLink>
        <ThemeToggle />
      </footer>
    </nav>
  </aside>
</template>

<style scoped>
/*
 * 袖は画面に固定する。本文（.shell）は中身の量で伸び縮みするので、
 * 流れの中に置くと、短い画面では袖まで途中で切れてしまう。
 */
.sidebar {
  position: fixed;
  top: 0;
  bottom: 0;
  left: 0;
  z-index: 18;
  width: var(--sidebar-width);
  background: var(--surface);
  border-right: 1px solid var(--border);
  overflow-y: auto;
  overscroll-behavior: contain;
  /*
   * 縦のスクロールバーは出さない（上の帯と同じ扱い）。中身が画面に
   * 収まっていても常に幅を取り、名前の右に細い帯が残って読みにくいため。
   * 触れるものが減るわけではなく、指でも車輪でもそのまま送れる。
   */
  scrollbar-width: none;
  /* 閉じている間は画面の外へ出す */
  transform: translateX(-100%);
  transition: transform 0.18s ease;
}

.sidebar::-webkit-scrollbar {
  display: none;
}

.sidebar--open {
  transform: none;
}

@media (prefers-reduced-motion: reduce) {
  .sidebar {
    transition: none;
  }
}

.sidebar__nav {
  /* 下の段を袖の下端へ送るため、縦に積んで高さいっぱいを使う */
  display: flex;
  flex-direction: column;
  gap: 0.125rem;
  min-height: 100%;
  padding: 0.75rem 0.5rem 0;
  /* 画面に固定しているので、セーフエリアは body の余白に頼れない */
  padding-left: calc(0.5rem + env(safe-area-inset-left));
  padding-top: calc(0.75rem + env(safe-area-inset-top));
  outline: none;
}

/* 重ねて出しているときの背景。本文を触れないようにして、押せば閉じる */
.scrim {
  position: fixed;
  inset: 0;
  z-index: 17;
  background: rgb(0 0 0 / 45%);
  /*
   * 端から引いた指を離したとき、袖が開ききるのに合わせて濃さも揃える
   * （引いている間は inline の transition: none で指に追わせる）。
   */
  transition: opacity 0.18s ease;
}

@media (prefers-reduced-motion: reduce) {
  .scrim {
    transition: none;
  }
}

/* 袖の中の ☰。開くときに押したボタン（app.vue の .menu）と同じ見た目にする */
.fold {
  align-self: start;
  min-width: 2rem;
  height: 2rem;
  display: grid;
  place-items: center;
  margin: 0 0 0.375rem 0.125rem;
  padding: 0;
  border: 1px solid var(--border);
  border-radius: 999px;
  background: var(--surface);
  color: var(--text-muted);
  font-size: 0.9375rem;
  line-height: 1;
}

.fold:hover {
  color: var(--text);
}

.item {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  min-height: 2rem;
  padding: 0.25rem 0.5rem;
  border-radius: 8px;
  color: var(--text);
  text-decoration: none;
  font-size: 0.9375rem;
}

.item:hover {
  background: var(--bg);
}

/* いま見ているところ。一覧のカーソルと同じ塗りで示す */
.item--active {
  background: var(--cursor-bg);
  font-weight: 600;
}

.item--top {
  font-weight: 600;
}

.item--head {
  flex: 1;
  min-width: 0;
  font-weight: 600;
  color: var(--text-muted);
  font-size: 0.8125rem;
  letter-spacing: 0.02em;
}

/* 見出しの下に付く行。字下げで親子が読み取れるようにする */
.item--child {
  padding-left: 1.5rem;
}

.item__label {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* 件数・「今日」。本文より控えめにして、名前を読む邪魔をしない */
.item__note {
  flex: 0 0 auto;
  color: var(--text-muted);
  font-size: 0.75rem;
}

.item__dot {
  flex: 0 0 auto;
  width: 0.625rem;
  height: 0.625rem;
  border-radius: 3px;
}

.group {
  margin-top: 0.75rem;
}

/*
 * 下の段。中身が短いときは下端へ、長いときはスクロールしても下端に残す
 * （sticky）。袖の背景と同じ色を敷き、下を流れる項目と重ならないようにする。
 */
.foot {
  position: sticky;
  bottom: 0;
  margin-top: auto;
  padding: 0.5rem 0 calc(0.5rem + env(safe-area-inset-bottom));
  display: flex;
  align-items: center;
  gap: 0.5rem;
  background: var(--surface);
  border-top: 1px solid var(--border);
}

.foot__link {
  flex: 1;
  min-width: 0;
}

.group__head {
  display: flex;
  align-items: center;
}

.group__fold {
  flex: 0 0 auto;
  width: 1.25rem;
  height: 1.5rem;
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--text-muted);
  font-size: 0.6875rem;
  line-height: 1;
}

.group__items {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: 0.125rem;
}

.group__empty {
  padding: 0.25rem 0.5rem 0.25rem 1.5rem;
  color: var(--text-muted);
  font-size: 0.8125rem;
}
</style>
