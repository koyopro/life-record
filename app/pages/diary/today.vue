<script setup lang="ts">
import { toAppDate } from '~~/shared/utils/date'

/**
 * 今日の日記へ振り分けるだけの経路（docs/14-app-shortcuts.md）。
 *
 * ホーム画面アイコンの長押しから出る「今日の日記を開く」の行き先。
 * manifest には日付を書けない（登録した日のまま固定されてしまう）ので、
 * 開いた時点の日付をここで決めて送る。
 *
 * タイムゾーンは固定（Asia/Tokyo）なので、サーバーで振り分けても
 * ブラウザで振り分けても同じ日になる。オフラインでも Service Worker が
 * 返す殻から同じ判断ができる（docs/12-offline.md 12.2）。
 *
 * `/diary/[date]` より先にこの経路が選ばれる（Nuxt は静的な区間を優先する）。
 */
useHead({ title: '今日の日記' })

// 履歴に残さない。戻ったときにここへ来て、また送り直されるのを避ける
await navigateTo(`/diary/${toAppDate()}`, { replace: true })
</script>

<template>
  <p class="loading">読み込み中…</p>
</template>

<style scoped>
.loading {
  margin: 0;
  color: var(--text-muted);
  text-align: center;
  padding: 2rem 0;
}
</style>
