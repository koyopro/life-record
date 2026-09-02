<script setup lang="ts">
import { isAppMonth, monthOf, toAppDate } from '~~/shared/utils/date'
import { diaryMonthPath } from '~~/shared/utils/diary-month'

/**
 * 月のページへ振り分けるだけの経路。
 *
 * カレンダーそのものは `/diary/month/YYYY-MM` にある。月に固有の
 * アドレスを与えないと、本文からその月を指せないため
 * （docs/11-scrapbox-notation.md 11.11）。ここは行き先を1つに保つための
 * 入口で、開いた時点の月へ送る。
 *
 * `?month=` で開かれたら、その月へ送る（このページが月を持っていた頃の
 * アドレス。本文や履歴に残っていても迷子にしない）。
 */
useHead({ title: '日記' })

const route = useRoute()
const month = isAppMonth(route.query.month)
  ? route.query.month
  : monthOf(toAppDate())

// 履歴に残さない。戻ったときにここへ来て、また送り直されるのを避ける
// （`/diary/today` と同じ）
await navigateTo(diaryMonthPath(month), { replace: true })
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
