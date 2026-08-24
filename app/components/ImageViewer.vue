<script setup lang="ts">
import { KEYBOARD_SURFACE_ATTR } from '~/utils/keyboard-surface'

/**
 * 画像の拡大表示（docs/11-scrapbox-notation.md 11.7）。
 *
 * 本文の画像を押すと、画面いっぱいに出す（Scrapbox と同じ）。
 * 出すのは1枚だけで、送り送りに見る仕組みは持たない。読み返している場所を
 * 見失わないよう、閉じたら元の位置へ戻る。
 */
const { image, close } = useImageViewer()

const overlay = ref<HTMLElement | null>(null)

/** 開く前にフォーカスしていた場所。閉じたらそこへ戻す。 */
let opener: HTMLElement | null = null

watch(image, async (value, previous) => {
  if (value && !previous) {
    opener = document.activeElement instanceof HTMLElement ? document.activeElement : null
    await nextTick()
    overlay.value?.focus()
    return
  }

  if (!value && previous) {
    opener?.focus({ preventScroll: true })
    opener = null
  }
})

/**
 * 開いている間は後ろを動かさない。
 *
 * 拡大したまま裏の一覧がスクロールすると、閉じたときに別の場所にいる。
 */
watchEffect((onCleanup) => {
  if (!import.meta.client || !image.value) return

  const root = document.documentElement
  const before = root.style.overflow
  root.style.overflow = 'hidden'
  onCleanup(() => {
    root.style.overflow = before
  })
})
</script>

<template>
  <!--
    画面のショートカットを止める印を付ける。拡大している間に `j` や
    `Delete` が一覧へ届くと、見ているだけのつもりで操作が起きてしまう。
  -->
  <div
    v-if="image"
    ref="overlay"
    class="viewer"
    role="dialog"
    aria-modal="true"
    aria-label="画像"
    tabindex="-1"
    v-bind="{ [KEYBOARD_SURFACE_ATTR]: '' }"
    @click="close"
    @keydown.esc.prevent="close"
  >
    <!-- 画像そのものを押しても閉じる（Scrapbox と同じ） -->
    <img class="viewer__image" :src="image.src" :alt="image.alt" />

    <button type="button" class="viewer__close" aria-label="閉じる" @click.stop="close">
      <span aria-hidden="true">✕</span>
    </button>
  </div>
</template>

<style scoped>
.viewer {
  position: fixed;
  inset: 0;
  /* 画像そのものを見るので、背景は明暗どちらでも暗くする */
  background: rgb(0 0 0 / 85%);
  display: grid;
  place-items: center;
  padding: 1rem;
  /* シート（20）・ダイアログ（30）より上に出す */
  z-index: 40;
  cursor: zoom-out;
}

/* 狭い画面では、余白より画像の大きさを優先する */
@media (max-width: 40rem) {
  .viewer {
    padding: 0.25rem;
  }
}

.viewer__image {
  max-width: 100%;
  /* 画面に収める。切り取らず、縦横比はそのまま */
  max-height: 100%;
  object-fit: contain;
}

.viewer__close {
  position: absolute;
  top: max(0.5rem, env(safe-area-inset-top));
  right: max(0.5rem, env(safe-area-inset-right));
  width: 2.75rem;
  height: 2.75rem;
  border: 0;
  border-radius: 999px;
  background: rgb(0 0 0 / 45%);
  color: #fff;
  font: inherit;
  font-size: 1.125rem;
  line-height: 1;
  cursor: pointer;
}
</style>
