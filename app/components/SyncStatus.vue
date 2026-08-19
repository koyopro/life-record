<script setup lang="ts">
/**
 * オンライン / 未同期の状態を示す小さな表示。
 *
 * 普段は何も出さない。オフラインのときと、まだサーバーへ送れていない
 * 変更があるときだけ出す（docs/12-offline.md 12.8）。
 * 競合したときは、何が起きたかを一行で知らせる。
 */
const { online } = useOnline()
const sync = useSync()

const CONFLICT_REASONS = {
  server_newer: '他の端末の変更があったため、サーバー側の内容にしました',
  server_deleted: '他の端末で削除されていたため、こちらでも削除しました',
} as const

/*
 * 送信中かどうかは文字ではなく●の点滅で示す（下記 sync__dot--syncing）。
 * 数字（件数）は変わらないので、送信の開始・終了で文字幅が変わって
 * 周りがずれることもない。
 */
const label = computed(() => {
  if (!online.value) return 'オフライン'
  if (sync.givenUp.value > 0) return `送れていません（${sync.givenUp.value}）`
  if (sync.pending.value > 0) return `未同期（${sync.pending.value}）`
  return null
})

/** 送れていない変更が残っているか。オフラインの表示より強く出す。 */
const stuck = computed(() => sync.givenUp.value > 0)

const title = computed(() => {
  if (!online.value) {
    return sync.pending.value > 0
      ? `オフラインです。${sync.pending.value}件の変更は、繋がったときに送ります`
      : 'オフラインです。変更はこの端末に保存され、繋がったときに送ります'
  }
  return sync.lastError.value ?? '未送信の変更があります'
})
</script>

<template>
  <div v-if="label || sync.conflicts.value.length" class="sync">
    <div v-if="label" class="sync__state" :class="{ 'sync__state--stuck': stuck }">
      <span
        class="sync__dot"
        :class="{ 'sync__dot--offline': !online, 'sync__dot--syncing': sync.syncing.value }"
      />
      <span :title="title">{{ label }}</span>
      <button v-if="stuck" type="button" class="sync__retry" @click="sync.retryFailed()">
        送り直す
      </button>
    </div>

    <!--
      競合の知らせ。黙って上書きしないための表示なので、
      読んで閉じてもらうまで残す。
    -->
    <p
      v-for="conflict in sync.conflicts.value"
      :key="conflict.itemId"
      class="sync__conflict"
      role="status"
    >
      <span class="sync__conflict-text">
        「{{ conflict.title || '無題' }}」{{ CONFLICT_REASONS[conflict.reason] }}
      </span>
      <button type="button" class="sync__close" @click="sync.dismiss(conflict.itemId)">
        閉じる
      </button>
    </p>
  </div>
</template>

<style scoped>
.sync {
  display: grid;
  gap: 0.25rem;
  font-size: 0.75rem;
}

.sync__state {
  display: inline-flex;
  align-items: center;
  gap: 0.375rem;
  color: var(--text-muted);
  white-space: nowrap;
}

.sync__state--stuck {
  color: var(--danger);
}

.sync__dot {
  width: 0.5rem;
  height: 0.5rem;
  border-radius: 999px;
  background: var(--accent);
}

.sync__dot--offline {
  background: var(--priority-none);
}

.sync__dot--syncing {
  animation: sync-dot-pulse 1s ease-in-out infinite;
}

@keyframes sync-dot-pulse {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0.35;
  }
}

.sync__retry {
  background: transparent;
  border: 1px solid currentcolor;
  border-radius: 999px;
  color: inherit;
  font-size: 0.6875rem;
  padding: 0 0.5rem;
  min-height: 1.5rem;
}

.sync__conflict {
  display: flex;
  align-items: baseline;
  gap: 0.5rem;
  margin: 0;
  color: var(--text-muted);
}

.sync__conflict-text {
  flex: 1;
}

.sync__close {
  background: transparent;
  border: 0;
  color: var(--accent);
  padding: 0;
  font-size: 0.6875rem;
}
</style>
