<script setup lang="ts">
/**
 * チェックしたタスクをまとめて操作する帯（docs/08-todo-management.md 8.4）。
 *
 * キーボードのない端末では、選んだあとに何もできることが無かった。
 * 1件も選んでいない間は描かないので、普段は場所を取らない。
 *
 * よく使うものだけを並べ、残りは「その他」から操作シートに送る。
 * 幅の狭い端末で押し間違えないよう、詰め込まずに横スクロールさせる。
 */
withDefaults(
  defineProps<{
    count: number
    /** 完了ボタンの文字。完了側を見ているときは戻す操作になる。 */
    completeLabel?: string
  }>(),
  { completeLabel: '完了' },
)

const emit = defineEmits<{
  complete: []
  due: []
  tags: []
  more: []
  clear: []
}>()
</script>

<template>
  <div class="bar" role="toolbar" aria-label="選択したタスクの操作">
    <span class="bar__count">{{ count }}件</span>

    <div class="bar__actions">
      <button type="button" class="bar__action" @click="emit('complete')">
        {{ completeLabel }}
      </button>
      <button type="button" class="bar__action" @click="emit('due')">
        期限
      </button>
      <button type="button" class="bar__action" @click="emit('tags')">
        タグ
      </button>
      <button type="button" class="bar__action" @click="emit('more')">
        その他
      </button>
    </div>

    <!-- 解除は流れの外なので、スクロールしても消えない右端に固定する -->
    <button
      type="button"
      class="bar__clear"
      aria-label="選択を解除"
      @click="emit('clear')"
    >
      <span aria-hidden="true">✕</span>
    </button>
  </div>
</template>

<style scoped>
/*
 * 下端に浮かせる。片手で押せる位置に置くため。
 * 操作シート（z-index 20）より下、「＋」（10）より上に重ねる。
 */
.bar {
  position: fixed;
  left: 0.5rem;
  right: 0.5rem;
  bottom: calc(0.5rem + env(safe-area-inset-bottom));
  z-index: 15;
  margin: 0 auto;
  max-width: 32rem;
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.375rem 0.5rem;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 12px;
  box-shadow: 0 4px 16px rgb(0 0 0 / 20%);
}

.bar__count {
  color: var(--text-muted);
  font-size: 0.8125rem;
  font-weight: 600;
  /* 件数が2桁になっても、ボタンの位置を動かさない */
  flex: 0 0 auto;
  padding-left: 0.25rem;
}

.bar__actions {
  display: flex;
  gap: 0.375rem;
  /* 入りきらないときは横に流す。詰めて小さくすると押しにくくなる */
  overflow-x: auto;
  flex: 1;
  min-width: 0;
  scrollbar-width: none;
}

.bar__actions::-webkit-scrollbar {
  display: none;
}

.bar__action {
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 999px;
  color: var(--text);
  /* タップ目標として十分な大きさを確保する */
  min-height: 2.5rem;
  padding: 0 0.875rem;
  font-size: 0.875rem;
  white-space: nowrap;
}

.bar__clear {
  flex: 0 0 auto;
  background: transparent;
  border: 0;
  color: var(--text-muted);
  min-width: 2.5rem;
  min-height: 2.5rem;
  font-size: 1rem;
  line-height: 1;
}
</style>
