<script setup lang="ts">
const emit = defineEmits<{ submit: [text: string] }>()

const text = ref('')
const textarea = ref<HTMLTextAreaElement | null>(null)

const canSubmit = computed(() => text.value.trim().length > 0)

/** 入力量に合わせて高さを伸ばす。スクロールが出ると書きづらいため。 */
function autoGrow() {
  const el = textarea.value
  if (!el) return
  el.style.height = 'auto'
  el.style.height = `${el.scrollHeight}px`
}

function submit() {
  if (!canSubmit.value) return
  emit('submit', text.value)
  // 送信完了を待たずに空にする。続けて書けることを優先する。
  text.value = ''
  nextTick(() => {
    autoGrow()
    textarea.value?.focus()
  })
}

function onKeydown(event: KeyboardEvent) {
  // Cmd / Ctrl + Enter で送信。Enter だけなら改行のまま。
  if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
    event.preventDefault()
    submit()
  }
}

onMounted(() => {
  // PC では開いてすぐ書き始められるようにする。
  // スマートフォンでは勝手にキーボードが出ると邪魔なのでフォーカスしない。
  if (!matchMedia('(hover: none)').matches) {
    textarea.value?.focus()
  }
})
</script>

<template>
  <form class="composer" @submit.prevent="submit">
    <textarea
      ref="textarea"
      v-model="text"
      class="composer__input"
      rows="2"
      placeholder="思いついたことを書く&#10;1行目がタイトルになります"
      enterkeyhint="enter"
      autocapitalize="off"
      @input="autoGrow"
      @keydown="onKeydown"
    />
    <div class="composer__actions">
      <span class="composer__hint">⌘ + Enter で追加</span>
      <button type="submit" class="composer__submit" :disabled="!canSubmit">
        追加
      </button>
    </div>
  </form>
</template>

<style scoped>
.composer {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  box-shadow: var(--shadow);
  padding: 0.75rem;
  display: grid;
  gap: 0.5rem;
}

.composer__input {
  width: 100%;
  min-height: 3.5rem;
  max-height: 60vh;
  resize: none;
  border: 0;
  outline: none;
  background: transparent;
  color: var(--text);
  padding: 0.25rem;
  overflow-y: auto;
}

.composer__input::placeholder {
  color: var(--text-muted);
}

.composer__actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
}

.composer__hint {
  color: var(--text-muted);
  font-size: 0.8125rem;
}

/* タッチ主体の端末ではショートカットが使えないので隠す */
@media (hover: none) {
  .composer__hint {
    visibility: hidden;
  }
}

.composer__submit {
  background: var(--accent);
  color: var(--accent-text);
  border: 0;
  border-radius: 8px;
  /* タップ目標として十分な大きさを確保する */
  min-height: 2.75rem;
  padding: 0 1.5rem;
  font-weight: 600;
}

.composer__submit:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
</style>
