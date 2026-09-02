<script setup lang="ts">
/**
 * オンライン / 未同期の状態を示す小さな表示。
 *
 * 普段は何も出さない。オフラインのときと、まだサーバーへ送れていない
 * 変更があるときだけ出す（docs/12-offline.md 12.8）。
 * 競合したときは、何が起きたかを一行で知らせる。
 */
import type { OperationKind } from '~/utils/offline/local-database'
import { MAX_ATTEMPTS } from '~/utils/offline/sync-queue'

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

/*
 * ここから下は「なぜ送れていないのか」を読むための詳細（docs/12-offline.md 12.8）。
 *
 * 数だけでは、失敗しているのか・待っているだけなのか・同じものを送り続けて
 * いるのかが分からない。マウスを当てて出る説明（title）は、macOS アプリの
 * WebView では出ないので、**画面の中に置く**。普段は閉じておく。
 */

/** 操作の種類を、人が読める名前にする。 */
const KIND_LABELS: Record<OperationKind, string> = {
  create: 'タスクの追加',
  patch: 'タスクの変更',
  delete: 'タスクの削除',
  tags: 'タグの付け外し',
  restore: 'タスクの復元',
  section_save: '作業記録の保存',
  section_delete: '作業記録の削除',
  section_reorder: '作業記録の並べ替え',
  diary_save: '日記の保存',
}

const open = ref(false)

/**
 * 開いている間だけ、1秒ごとに列の様子を取り直す。
 *
 * 「次に送るまであと何秒」と「この回で何件送ったか」は動くもので、
 * 動きが見えること自体が手がかりになる（数が伸び続けていれば、同じ操作を
 * 送り直し続けている）。閉じていれば止めるので、普段は何も走らない。
 */
const now = ref(Date.now())
let ticker: ReturnType<typeof setInterval> | null = null

function stopTicking() {
  if (!ticker) return
  clearInterval(ticker)
  ticker = null
}

// 出すものが無くなれば（すべて送り終えたら）表示ごと消えるので、そこでも止める
watch([open, label], ([value, current]) => {
  stopTicking()
  if (!value || !current) return
  void sync.refreshStatus()
  ticker = setInterval(() => {
    now.value = Date.now()
    void sync.refreshStatus()
  }, 1_000)
})

onBeforeUnmount(stopTicking)

/** いま送っているのか、待っているのか。 */
const sending = computed(() => {
  if (!sync.syncing.value) {
    if (!online.value) return '繋がるまで待っています'
    return sync.pending.value > 0 ? '次に送る時刻まで待っています' : '送るものはありません'
  }
  return sync.sentNow.value > 0
    ? `送っています（この回で ${sync.sentNow.value} 件送り終えました）`
    : '送っています'
})

/** 次に送る操作と、それを送るまでの間。 */
const next = computed(() => {
  const head = sync.head.value
  if (!head) return null
  const left = new Date(head.nextAttemptAt).getTime() - now.value
  const when = head.givenUp
    ? '自動では送り直しません'
    : left <= 0
      ? 'いま'
      : `あと ${Math.ceil(left / 1_000)} 秒`
  return { label: KIND_LABELS[head.kind], when, attempts: head.attempts }
})

/** 何が送れていないのか（種類ごとの件数）。 */
const waiting = computed(() =>
  sync.kinds.value.map(({ kind, count }) => `${KIND_LABELS[kind]} ${count}`).join('・'),
)
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
      <!--
        「なぜ送れていないのか」を読む入口。出すものがあるときだけ置く。
        普段は閉じておき、押した間だけ1秒ごとに取り直す。
      -->
      <button
        type="button"
        class="sync__more"
        :aria-expanded="open"
        @click="open = !open"
      >
        {{ open ? '閉じる' : '詳しく' }}
      </button>
    </div>

    <!--
      同期の様子。マウスを当てて出る説明は macOS アプリでは出ないので、
      画面の中に置く（docs/12-offline.md 12.8）。
    -->
    <dl v-if="open" class="sync__detail">
      <dt>いまの状態</dt>
      <dd>{{ sending }}</dd>

      <template v-if="waiting">
        <dt>待っているもの</dt>
        <dd>{{ waiting }}</dd>
      </template>

      <template v-if="next">
        <dt>次に送る</dt>
        <dd>{{ next.label }}（{{ next.when }}）</dd>

        <dt>試した回数</dt>
        <dd>{{ next.attempts }} / {{ MAX_ATTEMPTS }}</dd>
      </template>

      <dt>直近の失敗</dt>
      <dd>{{ sync.lastError.value ?? 'ありません' }}</dd>
    </dl>

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

.sync__more {
  background: transparent;
  border: 0;
  color: var(--accent);
  font-size: 0.6875rem;
  padding: 0 0.25rem;
  min-height: 1.5rem;
}

/*
 * 同期の様子。読むためだけのものなので、色は控えめにして本文の邪魔をしない。
 * 項目名と値を2桁で並べ、狭い画面では縦に積む。
 */
.sync__detail {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 0.125rem 0.5rem;
  margin: 0;
  color: var(--text-muted);
}

.sync__detail dt {
  white-space: nowrap;
}

.sync__detail dt::after {
  content: '：';
}

.sync__detail dd {
  margin: 0;
  overflow-wrap: anywhere;
}

@media (max-width: 26rem) {
  .sync__detail {
    grid-template-columns: 1fr;
  }

  .sync__detail dd {
    margin-bottom: 0.25rem;
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
