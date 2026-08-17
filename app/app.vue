<template>
  <div class="shell">
    <header class="shell__header">
      <nav class="nav">
        <NuxtLink to="/today" class="nav__link">今日</NuxtLink>
        <NuxtLink to="/" class="nav__link">Inbox</NuxtLink>
        <NuxtLink to="/items" class="nav__link">タスク</NuxtLink>
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

.nav__link.router-link-exact-active {
  color: var(--text);
  border-bottom-color: var(--accent);
}
</style>
