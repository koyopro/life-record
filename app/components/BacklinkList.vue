<script setup lang="ts">
import type { Backlink } from '~~/shared/types/backlink'
import { formatAppDate } from '~~/shared/utils/date'

/**
 * 「このページを指しているもの」＝バックリンクの一覧
 * （docs/11-scrapbox-notation.md 11.11）。
 *
 * 月のページとタスクの詳細で同じものを出す。指し方（本文に書いたリンク）も
 * 引き方（パスの部分一致）も同じなので、見せ方も1か所にまとめる。ページの
 * 種類ごとに違う見た目を作ると、同じリンクなのに読み方を覚え直すことになる。
 */
const props = withDefaults(
  defineProps<{
    /** このページのパス。本文にこれを書いたものが並ぶ。 */
    path: string
    /** 見出し（「この月を指しているもの」など）。 */
    title: string
    /**
     * 1件も無いときも、見出しと案内を出すか。
     *
     * 月のページは出す（そこが読みものの本体）。タスクの詳細は出さない
     * （本体は作業記録で、空の箱が毎回下に残ると邪魔になる）。
     */
    showEmpty?: boolean
  }>(),
  { showEmpty: true },
)

const store = useBacklinkStore()

const path = computed(() => props.path)
const { pending, refresh } = store.track(path)

/** 控えを持っていれば、それがそのまま画面に出るもの。 */
const links = computed<Backlink[]>(() => store.linksOf(props.path) ?? [])

const KIND_LABELS: Record<Backlink['kind'], string> = {
  item: 'メモ',
  section: '作業記録',
  diary: '日記',
}

/** 画面へ戻ってきたときに取り直すために、置いている側から呼べるようにする。 */
defineExpose({ refresh })
</script>

<template>
  <section v-if="links.length || showEmpty" class="links">
    <header class="links__head">
      <h2 class="links__title">{{ title }}</h2>
      <!-- ページごとの操作（月のページの「リンクをコピー」など） -->
      <div class="links__actions">
        <slot name="actions" />
      </div>
    </header>

    <slot name="notice" />

    <ul v-if="links.length" class="links__list">
      <li v-for="link in links" :key="link.id" class="link">
        <NuxtLink class="link__body" :to="link.path">
          <span class="link__kind">{{ KIND_LABELS[link.kind] }}</span>
          <span class="link__title">{{ link.title }}</span>
          <span v-if="link.kind !== 'item'" class="link__date">
            {{ formatAppDate(link.date) }}
          </span>
        </NuxtLink>

        <!--
          指してきた本文の冒頭だけ。続きはリンク先で読む。
          リンクの外に置く（記法の中のリンクが入れ子にならないように）
        -->
        <div v-if="link.head.text" class="link__head">
          <ScrapboxEditor
            view
            :model-value="link.head.text"
            :aria-label="`「${link.title}」の冒頭`"
          />
          <p v-if="link.head.truncated" class="link__more">…</p>
        </div>
      </li>
    </ul>

    <p v-else-if="pending" class="links__placeholder">読み込み中…</p>

    <p v-else class="links__empty">
      <slot name="empty">
        まだありません。本文に <code>[{{ path }}]</code> と書くと、ここに出る。
      </slot>
    </p>
  </section>
</template>

<style scoped>
.links {
  display: grid;
  gap: 0.5rem;
  max-width: 900px;
}

.links__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
}

.links__title {
  margin: 0;
  font-size: 0.875rem;
  font-weight: 700;
  color: var(--text-muted);
}

.links__actions {
  display: flex;
  align-items: center;
  gap: 0.375rem;
}

.links__list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: 1px;
  background: var(--border);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  overflow: hidden;
}

/* 見出しの行と冒頭を縦に積む。枠（背景）は行ごとに1つ */
.link {
  background: var(--surface);
  display: grid;
  gap: 0.375rem;
  padding: 0.5rem 0.625rem;
  min-width: 0;
}

.link__body {
  color: inherit;
  text-decoration: none;
  display: flex;
  align-items: baseline;
  flex-wrap: wrap;
  gap: 0.5rem;
}

.link__kind {
  color: var(--text-muted);
  font-size: 0.6875rem;
  border: 1px solid var(--border);
  border-radius: 999px;
  padding: 0 0.375rem;
  flex-shrink: 0;
}

.link__title {
  font-size: 0.875rem;
  font-weight: 600;
}

.link__date {
  color: var(--text-muted);
  font-size: 0.75rem;
  font-variant-numeric: tabular-nums;
}

/*
 * 指してきた本文の冒頭。日記の「この日にやったこと」と同じ顔にする
 * （見出しの行より控えめに、記法はそのまま解釈して出す）。
 */
.link__head {
  padding-left: 0.75rem;
  border-left: 2px solid var(--border);
  font-size: 0.875rem;
  color: var(--text-muted);
}

.link__more {
  margin: 0;
  color: var(--text-muted);
}

.links__empty code {
  font-size: 0.75rem;
}

.links__placeholder,
.links__empty {
  margin: 0;
  color: var(--text-muted);
  font-size: 0.8125rem;
  line-height: 1.7;
  overflow-wrap: anywhere;
}
</style>
