<script setup lang="ts">
import { formatAppDateShort, shiftAppDate } from '~~/shared/utils/date'
import { tagColorVar } from '~/utils/tag-color'

/**
 * 左袖のナビゲーション（RTM の左側に合わせる）。
 *
 * 上の帯（app.vue の NAV）が「どの画面か」を選ぶのに対して、ここは
 * **どの絞り込みを見るか**を選ぶ場所。リスト・タグ・日記の中身まで
 * 出しておき、一覧 → 一覧の移動を1押しで済ませる。
 *
 * 開閉は `;` とハンバーガー（app.vue）。広い画面（60rem 以上）では本文の
 * 横に並べ、狭い画面では本文に重ねて出す（useSidebar）。
 */
const { open, docked, close, isCollapsed, toggleSection } = useSidebar()

const route = useRoute()
const today = useToday()
const { lists } = useSmartLists()
const { tags } = useTags()

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
  -->
  <div v-if="open && !docked" class="scrim" @click="close" />

  <aside class="sidebar" :class="{ 'sidebar--open': open }">
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
  /* 閉じている間は画面の外へ出す */
  transform: translateX(-100%);
  transition: transform 0.18s ease;
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
  display: grid;
  gap: 0.125rem;
  align-content: start;
  padding: 0.75rem 0.5rem 2rem;
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
