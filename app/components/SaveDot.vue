<script setup lang="ts">
import type { SaveState } from '~/composables/useAutosave'

/**
 * `idle` 以外に、サーバーへまだ送れていない（オフライン等）を示す状態を足す。
 * 文字と違って幅を持たないので、意味の数だけ状態を増やしても場所を取らない。
 */
export type SaveDotState = SaveState | 'unsynced'

const props = defineProps<{ state: SaveDotState }>()

const TITLES: Record<SaveDotState, string> = {
  idle: '',
  pending: '未保存の変更があります',
  saving: '保存中…',
  saved: '保存しました',
  error: '保存に失敗しました',
  unsynced: 'サーバーへまだ送れていません',
}

const title = computed(() => TITLES[props.state] || undefined)
</script>

<template>
  <span class="save-dot" :class="`save-dot--${state}`" :title="title" :aria-label="title" />
</template>

<style scoped>
/*
 * 「保存中」「未保存」のような文字は出たり消えたりするたびに幅が変わり、
 * 隣の要素がずれる。常に同じ大きさの●として置き、色（と idle の透明）だけ
 * 変えることで、出し引きしても周りが動かないようにする。
 */
.save-dot {
  display: inline-block;
  flex: 0 0 auto;
  width: 0.5rem;
  height: 0.5rem;
  border-radius: 999px;
  background: transparent;
}

.save-dot--pending {
  background: var(--text-muted);
}

.save-dot--saving {
  background: var(--accent);
  animation: save-dot-pulse 1s ease-in-out infinite;
}

.save-dot--saved {
  background: var(--accent);
}

.save-dot--unsynced {
  background: var(--priority-none);
}

.save-dot--error {
  background: var(--danger);
}

@keyframes save-dot-pulse {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0.35;
  }
}
</style>
