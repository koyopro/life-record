<script setup lang="ts">
/**
 * 「本当に消しますか？」の問い合わせ（app/composables/useConfirm.ts）。
 *
 * ブラウザの `confirm()` の代わり。macOS アプリ（WKWebView）では
 * `confirm()` が出ないため、アプリの中で出す（docs/16-macos-app.md 16.8）。
 * どの画面からも同じものを使うので、app.vue に1つだけ置く。
 */
const { request, answer } = useConfirm()

const okButton = ref<HTMLElement | null>(null)

/*
 * 開いたら実行する側のボタンへフォーカスする。Enter でそのまま進められ、
 * Esc で閉じられる（ダイアログの外にフォーカスがあると、一覧の Esc に
 * 取られてしまう）。
 */
watch(request, async (value) => {
  if (!value) return
  await nextTick()
  okButton.value?.focus()
})
</script>

<template>
  <div v-if="request" class="overlay" @click.self="answer(false)">
    <div
      class="sheet"
      role="dialog"
      aria-modal="true"
      aria-label="確認"
      @keydown.esc.prevent="answer(false)"
    >
      <p class="sheet__message">{{ request.message }}</p>

      <div class="sheet__actions">
        <button type="button" class="sheet__button" @click="answer(false)">
          キャンセル
        </button>
        <button
          ref="okButton"
          type="button"
          class="sheet__button sheet__button--ok"
          :class="{ 'sheet__button--danger': request.danger }"
          @click="answer(true)"
        >
          {{ request.confirmLabel }}
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* 他のダイアログ（GoToTagDialog など）と同じ重なりにする */
.overlay {
  position: fixed;
  inset: 0;
  background: rgb(0 0 0 / 45%);
  display: grid;
  place-items: center;
  padding: 1rem;
  z-index: 30;
}

.sheet {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  box-shadow: var(--shadow);
  width: min(24rem, 100%);
  padding: 1rem;
  display: grid;
  gap: 1rem;
}

.sheet__message {
  margin: 0;
  font-size: 0.9375rem;
  /* 長い名前でも枠からはみ出させない */
  overflow-wrap: anywhere;
}

.sheet__actions {
  display: flex;
  justify-content: flex-end;
  gap: 0.5rem;
}

.sheet__button {
  font: inherit;
  font-size: 0.875rem;
  min-height: 2.25rem;
  padding: 0 0.875rem;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: transparent;
  color: var(--text);
}

.sheet__button--ok {
  background: var(--accent);
  border-color: var(--accent);
  color: var(--accent-text);
  font-weight: 600;
}

/* 取り返しの付かない操作（削除）は、押す前に色で分かるようにする */
.sheet__button--danger {
  background: var(--danger);
  border-color: var(--danger);
  color: #ffffff;
}
</style>
