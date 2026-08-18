<script setup lang="ts">
/**
 * Service Worker がオフライン時に返す「殻」。
 *
 * オフラインでは /today などの HTML をサーバーから取れない。そこで
 * Service Worker はどの画面への移動にもこのページを返し、ブラウザ側で
 * いまの URL に対応する画面を描く（docs/12-offline.md 12.2）。
 *
 * このページ自身が見えるのは、直接開いたときだけ。中身は要らない。
 * SSR しない（nuxt.config.ts の routeRules）ため、ビルド時に静的な
 * HTML として書き出され、Service Worker がそれを持っておける。
 */
definePageMeta({ layout: false })

useHead({ title: '読み込み中' })
</script>

<template>
  <p class="shell">読み込み中…</p>
</template>

<style scoped>
.shell {
  color: var(--text-muted);
  text-align: center;
  padding: 2rem 0;
}
</style>
