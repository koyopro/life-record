<script setup lang="ts">
/**
 * 新しい版があることの知らせ（docs/12-offline.md 12.2）。
 *
 * 更新は書きかけが片付いてから当てる（useAppUpdate）。黙って待っていると
 * 「あとから急に画面が入れ替わった」と見えるので、待っている間は出しておく。
 * 出し先は SyncStatus と同じ、画面の上端に1つだけ（app.vue）。
 */
const { ready, waiting, applyNow } = useAppUpdate()
</script>

<template>
  <p v-if="ready" class="update" role="status">
    <span class="update__dot" />
    <span class="update__text">
      {{
        waiting
          ? '新しい版があります。書きかけが片付いたら更新します'
          : '新しい版があります。まもなく更新します'
      }}
    </span>
    <button type="button" class="update__now" @click="applyNow">いま更新</button>
  </p>
</template>

<style scoped>
/* オフライン・未同期の知らせ（SyncStatus）と同じ見た目にそろえる */
.update {
  display: flex;
  align-items: center;
  gap: 0.375rem;
  margin: 0;
  color: var(--text-muted);
  font-size: 0.75rem;
}

.update__dot {
  flex: 0 0 auto;
  width: 0.5rem;
  height: 0.5rem;
  border-radius: 999px;
  background: var(--accent);
}

.update__text {
  flex: 1;
}

.update__now {
  flex: 0 0 auto;
  background: transparent;
  border: 1px solid currentcolor;
  border-radius: 999px;
  color: inherit;
  font-size: 0.6875rem;
  padding: 0 0.5rem;
  min-height: 1.5rem;
}
</style>
