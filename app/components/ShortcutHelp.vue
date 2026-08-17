<script setup lang="ts">
import { shortcutDisplay, type Shortcut } from '~/composables/useShortcuts'

defineProps<{
  groups: { name: string; items: Shortcut[] }[]
}>()

const emit = defineEmits<{ close: [] }>()

const dialog = ref<HTMLElement | null>(null)

onMounted(() => dialog.value?.focus())
</script>

<template>
  <div class="overlay" @click.self="emit('close')">
    <div
      ref="dialog"
      class="sheet"
      role="dialog"
      aria-modal="true"
      aria-label="キーボードショートカット"
      tabindex="-1"
    >
      <header class="sheet__header">
        <h2 class="sheet__title">キーボードショートカット</h2>
        <button type="button" class="sheet__close" @click="emit('close')">
          閉じる
        </button>
      </header>

      <!-- 一覧は定義そのものから作る。実装とヘルプがずれないようにするため -->
      <div class="sheet__groups">
        <section v-for="group in groups" :key="group.name">
          <h3 class="sheet__group-name">{{ group.name }}</h3>
          <dl class="sheet__list">
            <template v-for="shortcut in group.items" :key="shortcut.label">
              <dt><kbd>{{ shortcutDisplay(shortcut) }}</kbd></dt>
              <dd>{{ shortcut.label }}</dd>
            </template>
          </dl>
        </section>
      </div>
    </div>
  </div>
</template>

<style scoped>
.overlay {
  position: fixed;
  inset: 0;
  background: rgb(0 0 0 / 45%);
  display: grid;
  place-items: center;
  padding: 1rem;
  z-index: 20;
}

.sheet {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  box-shadow: var(--shadow);
  width: min(34rem, 100%);
  max-height: 80vh;
  overflow-y: auto;
  padding: 1rem;
  outline: none;
}

.sheet__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  margin-bottom: 0.75rem;
}

.sheet__title {
  margin: 0;
  font-size: 1rem;
}

.sheet__close {
  background: transparent;
  border: 1px solid var(--border);
  border-radius: 8px;
  color: var(--text-muted);
  min-height: 2.25rem;
  padding: 0 0.75rem;
}

.sheet__groups {
  display: grid;
  gap: 1rem;
}

.sheet__group-name {
  margin: 0 0 0.375rem;
  font-size: 0.8125rem;
  color: var(--text-muted);
  font-weight: 600;
}

.sheet__list {
  margin: 0;
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 0.375rem 0.75rem;
  align-items: baseline;
}

.sheet__list dd {
  margin: 0;
  font-size: 0.9375rem;
}

kbd {
  display: inline-block;
  min-width: 1.5rem;
  text-align: center;
  border: 1px solid var(--border);
  border-bottom-width: 2px;
  border-radius: 5px;
  padding: 0.0625rem 0.375rem;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 0.8125rem;
}
</style>
