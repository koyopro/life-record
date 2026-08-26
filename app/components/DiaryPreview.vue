<script setup lang="ts">
import { formatAppDate } from '~~/shared/utils/date'

/**
 * 日記の中身を、読むだけで出す（検索結果の右ペイン）。
 *
 * 探している最中に「その日に何を書いたか」を確かめられれば足りるので、
 * ここでは**書けるようにしない**。書く場所は日記のページ1つに保つ
 * （2か所から同じ本文を編集できると、保存の行き先が分かりにくくなる）。
 *
 * 日付ごとに作り直して使う（`:key`）。取得はストアに任せるので、
 * 一度読んだ日はオフラインでもそのまま読める。
 */
const props = defineProps<{ date: string }>()

const store = useDiaryStore()

const date = computed(() => props.date)
const { error: fetchError } = store.track(date)

const body = computed(() => store.bodyOf(props.date))

/** 読み込めなかった。手元に出せているときは、それを優先して知らせない。 */
const error = computed(() => (store.knows(props.date) ? null : fetchError.value))
</script>

<template>
  <article class="diary">
    <header class="diary__head">
      <h2 class="diary__title">{{ formatAppDate(date) }}の日記</h2>
      <NuxtLink class="diary__open" :to="`/diary/${date}`">開いて書く</NuxtLink>
    </header>

    <p v-if="error" class="diary__error" role="alert">{{ error }}</p>
    <p v-else-if="!body.trim()" class="diary__empty">まだ何も書かれていません。</p>
    <!--
      記法の見え方は書くときと同じにする（ScrapboxEditor の `view`）。
      検索結果でだけ別の見た目になると、同じ本文だと読み取りにくい。
    -->
    <ScrapboxEditor v-else :model-value="body" view aria-label="日記" />
  </article>
</template>

<style scoped>
.diary {
  display: grid;
  gap: 0.5rem;
}

.diary__head {
  display: flex;
  align-items: baseline;
  gap: 0.75rem;
}

.diary__title {
  margin: 0;
  font-size: 1rem;
  font-weight: 700;
}

.diary__open {
  color: var(--accent);
  font-size: 0.8125rem;
  text-decoration: none;
}

.diary__empty,
.diary__error {
  margin: 0;
  color: var(--text-muted);
  font-size: 0.875rem;
}

.diary__error {
  color: var(--danger);
}
</style>
