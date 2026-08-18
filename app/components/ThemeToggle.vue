<script setup lang="ts">
const { mode, resolved, cycle } = useTheme()

/**
 * 押すたびに次のテーマへ移る。
 *
 * 選択肢を並べると、ただでさえ横幅の足りないスマートフォンの
 * ヘッダーが窮屈になる。3 つしかないので、押していけば戻れる。
 */
const ICONS: Record<typeof mode.value, string> = {
  system: '◐',
  light: '☀',
  dark: '☾',
}

const label = computed(() => `表示テーマ: ${THEME_LABELS[mode.value]}`)

// ブラウザの表示欄（アドレスバー）の色も合わせる。ここだけ明るいままだと浮く
useHead({
  meta: [
    {
      name: 'theme-color',
      content: computed(() => (resolved.value === 'dark' ? '#161614' : '#f6f6f4')),
    },
  ],
})
</script>

<template>
  <button
    type="button"
    class="theme"
    :aria-label="label"
    :title="`${label}（押すと切り替え）`"
    @click="cycle"
  >
    <span aria-hidden="true">{{ ICONS[mode] }}</span>
  </button>
</template>

<style scoped>
.theme {
  /* 指で押せる大きさを確保する */
  min-width: 2rem;
  height: 2rem;
  display: grid;
  place-items: center;
  padding: 0;
  border: 1px solid var(--border);
  border-radius: 999px;
  background: var(--surface);
  color: var(--text-muted);
  font-size: 0.9375rem;
  line-height: 1;
}

.theme:hover {
  color: var(--text);
}
</style>
