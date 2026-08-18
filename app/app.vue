<script setup lang="ts">
const route = useRoute()

/**
 * 分割表示を使う画面は、既定の読みやすい幅（40rem）では狭すぎるため広げる。
 * 画面側が `definePageMeta({ wide: true })` で申告する。
 */
const wide = computed(() => Boolean(route.meta.wide))

const NAV = [
  { to: '/today', label: '今日' },
  { to: '/', label: 'Inbox' },
  { to: '/items', label: 'タスク' },
  { to: '/diary', label: '日記' },
  { to: '/search', label: '検索' },
]

/**
 * いまどの区分にいるか。
 *
 * `router-link-active` に任せられない。`/items` と `/items/:id` は
 * Nuxt では親子ではなく別々のルートなので、詳細画面にいるときに
 * 一覧のリンクが active にならない。
 */
function isActive(to: string): boolean {
  if (to === '/') return route.path === '/'
  return route.path === to || route.path.startsWith(`${to}/`)
}
</script>

<template>
  <div class="shell" :class="{ 'shell--wide': wide }">
    <header class="shell__header">
      <nav class="nav">
        <NuxtLink
          v-for="entry in NAV"
          :key="entry.to"
          :to="entry.to"
          class="nav__link"
          :class="{ 'nav__link--active': isActive(entry.to) }"
        >
          {{ entry.label }}
        </NuxtLink>
      </nav>
    </header>
    <main class="shell__main">
      <NuxtPage />
    </main>
  </div>
</template>

<style scoped>
.shell {
  /* スマートフォンでの片手操作を基準に、幅は読みやすい範囲に留める */
  max-width: 40rem;
  margin: 0 auto;
  padding: 0.75rem 1rem 4rem;
}

/* 一覧と詳細を並べる画面だけ、必要な幅まで広げる */
.shell--wide {
  max-width: 76rem;
}

.shell__header {
  padding-bottom: 0.75rem;
}

.nav {
  display: flex;
  gap: 1rem;
}

.nav__link {
  color: var(--text-muted);
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
