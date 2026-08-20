<script setup lang="ts">
import { isOpenableUrl } from '~~/shared/types/item'
import {
  composeShare,
  hasSharedContent,
  type SharedContent,
} from '~~/shared/utils/share'
import { buildItemDraft } from '~/utils/item-draft'

/**
 * OS の共有シートから開かれる受付画面（docs/13-share-target.md）。
 *
 * manifest の share_target が、共有された内容をクエリ（url / title / text）
 * にしてここへ渡す。やることは「内容を見せる」「保存する」だけで、
 * 保存そのものは一覧の入力欄と同じ経路（buildItemDraft → useItemStore）を通る。
 */

useHead({ title: '共有を受け取る' })

const route = useRoute()
const store = useItemStore()

/** 受け取った内容。ブラウザ側で確定する（控えから戻す場合があるため）。 */
const shared = ref<SharedContent | null>(null)
/** 受け取った内容が決まったか。サーバー描画の時点ではまだ分からない。 */
const ready = ref(false)
const errorMessage = ref<string | null>(null)
/** 保存できた Item。null なら保存前。 */
const saved = ref<{ id: string; title: string } | null>(null)

const composed = computed(() => (shared.value ? composeShare(shared.value) : null))

onMounted(() => {
  const received = readQuery()

  if (hasSharedContent(received)) {
    shared.value = received
    hold(received)
  } else {
    // クエリを失って開き直された場合に備えて控えてある（下の hold）
    shared.value = held()
  }

  ready.value = true
})

/** クエリから共有された内容を読む。同じ名前が二度来たら先のものを使う。 */
function readQuery(): SharedContent {
  return {
    url: queryValue(route.query.url),
    title: queryValue(route.query.title),
    text: queryValue(route.query.text),
  }
}

function queryValue(value: unknown): string | undefined {
  const first = Array.isArray(value) ? value[0] : value
  return typeof first === 'string' ? first : undefined
}

async function save(text: string) {
  const result = buildItemDraft(text)

  if ('error' in result) {
    errorMessage.value = result.error
    return
  }

  errorMessage.value = null
  // ローカルへ書いて送信の列に積むところまで。オフラインでも保存できる
  await store.create(result.draft, text)
  release()

  saved.value = { id: result.draft.id, title: result.draft.title }
}

function cancel() {
  release()
  return navigateTo('/')
}

/*
 * 受け取った内容の控え（同じタブの中だけ）。
 *
 * 保存する前にこの画面が開き直されると、共有された内容は戻ってこない。
 * 短いあいだだけ控えておき、クエリの無い /share で開かれたときに使う。
 * 保存・キャンセルしたら消す。古い共有が後から蘇らないよう期限を付ける。
 */
const HOLD_KEY = 'share:pending'
const HOLD_MAX_AGE_MS = 10 * 60 * 1000

function hold(content: SharedContent) {
  try {
    sessionStorage.setItem(
      HOLD_KEY,
      JSON.stringify({ content, at: Date.now() }),
    )
  } catch {
    // 使えない環境（容量・設定）では控えないだけ。共有の受付は続けられる
  }
}

function held(): SharedContent | null {
  try {
    const stored = sessionStorage.getItem(HOLD_KEY)
    if (!stored) return null

    const parsed = JSON.parse(stored) as { content: SharedContent; at: number }
    if (Date.now() - parsed.at > HOLD_MAX_AGE_MS) {
      sessionStorage.removeItem(HOLD_KEY)
      return null
    }
    return hasSharedContent(parsed.content) ? parsed.content : null
  } catch {
    return null
  }
}

function release() {
  try {
    sessionStorage.removeItem(HOLD_KEY)
  } catch {
    // 消せなくても期限で切れる
  }
}
</script>

<template>
  <div class="page">
    <!-- 保存後 -->
    <template v-if="saved">
      <h1 class="page__title">保存しました</h1>
      <p class="page__lead">
        「{{ saved.title }}」を追加しました。
      </p>
      <div class="page__actions">
        <NuxtLink class="button button--primary" :to="`/items/${saved.id}`">
          Item を見る
        </NuxtLink>
        <NuxtLink class="button" to="/">タスクを見る</NuxtLink>
      </div>
    </template>

    <!-- 受け取った内容の確認 -->
    <template v-else-if="ready && composed">
      <h1 class="page__title">共有を受け取りました</h1>

      <dl v-if="composed.url || shared?.title || shared?.text" class="shared">
        <template v-if="composed.url">
          <dt class="shared__label">URL</dt>
          <dd class="shared__value">
            <a
              v-if="isOpenableUrl(composed.url)"
              :href="composed.url"
              target="_blank"
              rel="noopener noreferrer"
            >{{ composed.url }}</a>
            <span v-else>{{ composed.url }}</span>
          </dd>
        </template>
        <template v-if="shared?.title">
          <dt class="shared__label">タイトル</dt>
          <dd class="shared__value">{{ shared.title }}</dd>
        </template>
        <template v-if="shared?.text">
          <dt class="shared__label">text</dt>
          <dd class="shared__value shared__value--text">{{ shared.text }}</dd>
        </template>
      </dl>

      <!--
        一覧と同じ入力欄。1行目がタイトル、2行目以降が本文になる。
        書き直してからでも保存できる（SmartAdd の記法もそのまま効く）。
      -->
      <!-- 共有を受け取ったあとに書く画面なので、狭い画面でもそのまま出す -->
      <ItemComposer
        inline
        :initial-text="composed.text"
        submit-label="保存"
        placeholder="1行目がタイトルになります"
        @submit="save"
      />

      <p v-if="errorMessage" class="page__error">{{ errorMessage }}</p>

      <button type="button" class="button button--quiet" @click="cancel">
        保存せずに戻る
      </button>
    </template>

    <!-- 共有ではなく直接開かれた -->
    <template v-else-if="ready">
      <h1 class="page__title">共有された内容がありません</h1>
      <p class="page__lead">
        この画面は、他のアプリからの共有を受け取るためのものです。
        ホーム画面に追加したこのアプリを、共有先として選んでください。
      </p>
      <div class="page__actions">
        <NuxtLink class="button button--primary" to="/">タスクを見る</NuxtLink>
      </div>
    </template>

    <!-- 受け取った内容が決まる前（サーバー描画の一瞬） -->
    <p v-else class="page__lead">読み込み中…</p>
  </div>
</template>

<style scoped>
.page {
  display: grid;
  gap: 1rem;
  /* 戻る操作は下端に置く。上へ寄せると保存の導線と並んで押し間違える */
  justify-items: stretch;
}

.page__title {
  font-size: 1.125rem;
  margin: 0;
}

.page__lead {
  color: var(--text-muted);
  margin: 0;
  line-height: 1.6;
}

.page__error {
  color: var(--danger);
  margin: 0;
}

.shared {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 0.75rem;
  margin: 0;
  display: grid;
  /* 狭い画面では値を折り返させたいので、ラベルは必要な幅だけ */
  grid-template-columns: auto 1fr;
  gap: 0.375rem 0.75rem;
  font-size: 0.875rem;
}

.shared__label {
  color: var(--text-muted);
}

.shared__value {
  margin: 0;
  /* 長い URL でも横に溢れさせない */
  overflow-wrap: anywhere;
  min-width: 0;
}

/* 共有元の text は改行を保つ。引用がそのまま渡ってくることがある */
.shared__value--text {
  white-space: pre-wrap;
  /* 長文が来ても画面を埋め尽くさない */
  max-height: 8rem;
  overflow-y: auto;
}

.page__actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.75rem;
}

.button {
  /* タップ目標として十分な大きさを確保する */
  min-height: 2.75rem;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0 1.25rem;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--surface);
  color: var(--text);
  font-weight: 600;
  text-decoration: none;
}

.button--primary {
  background: var(--accent);
  color: var(--accent-text);
  border-color: transparent;
}

.button--quiet {
  border-color: transparent;
  background: transparent;
  color: var(--text-muted);
  justify-self: start;
  padding: 0;
}
</style>
