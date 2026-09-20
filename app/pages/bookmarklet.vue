<script setup lang="ts">
import { buildAmazonBookmarklet } from '~/utils/bookmarklet'
import { writeToClipboard } from '~/utils/clipboard'

/**
 * ブックマークレットの受け取り口（docs/17-bookmarklet.md）。
 *
 * PC のブラウザには共有シートが無い（docs/13-share-target.md 13.6）ので、
 * 代わりにブックマークバーから押せるものを配る。ここでやることは
 * 「登録できる形で置く」だけで、取り込み自体は /share が受ける。
 */

useHead({ title: 'ブックマークレット' })

/**
 * いま開いている場所。ブックマークレットの開く先（`/share`）に埋める。
 *
 * 置き場は本番・プレビュー・手元（localhost）で違い、押したときに開くのは
 * **登録した時点の場所**になる。見ている画面から作れば、その画面の
 * アプリへ入る（手元で作ったものが本番を開いてしまうことがない）。
 */
const origin = useRequestURL().origin

const bookmarklet = computed(() => buildAmazonBookmarklet(origin))

/** コピーできたことの知らせ。少しだけ出す。 */
const copied = ref(false)
let copiedTimer: ReturnType<typeof setTimeout> | null = null

async function copy() {
  if (!(await writeToClipboard(bookmarklet.value))) return

  copied.value = true
  if (copiedTimer) clearTimeout(copiedTimer)
  copiedTimer = setTimeout(() => {
    copied.value = false
  }, 2_000)
}

onBeforeUnmount(() => {
  if (copiedTimer) clearTimeout(copiedTimer)
})
</script>

<template>
  <div class="page">
    <h1 class="page__title">ブックマークレット</h1>

    <p class="page__lead">
      Amazon の商品ページで押すと、タイトル・URL・表紙の画像を持ったまま
      このアプリの取り込み画面（<code>/share</code>）が開きます。
      内容を確かめて「保存」すると、未着手のタスクになります。
    </p>

    <section class="install">
      <h2 class="install__title">登録する</h2>
      <p class="install__lead">
        下のリンクを<strong>ブックマークバーへドラッグ</strong>してください。
        ドラッグできないブラウザでは、ブックマークを新しく作り、URL 欄に
        コピーした中身を貼り付けます。
      </p>

      <!--
        押すためではなく、ブックマークバーへ引いてもらうためのリンク。
        この画面で押しても（Amazon ではないので）何も取り込めない。
      -->
      <p class="install__drag">
        <a class="chip" :href="bookmarklet" @click.prevent>Amazon → タスク</a>
      </p>

      <p class="install__actions">
        <button type="button" class="button" @click="copy">
          中身をコピー
        </button>
        <span v-if="copied" class="install__copied" role="status">
          コピーしました
        </span>
      </p>
    </section>

    <section class="use">
      <h2 class="use__title">使う</h2>
      <ol class="use__steps">
        <li>Amazon で本の商品ページを開く</li>
        <li>ブックマークバーの「Amazon → タスク」を押す</li>
        <li>開いた取り込み画面で内容を確かめ、「保存」を押す</li>
      </ol>
      <p class="use__note">
        URL は <code>https://www.amazon.co.jp/dp/&lt;商品の番号&gt;</code> だけに
        直して入ります（商品名や <code>ref=</code> は落とします）。
        ページの画像はメモに記法（<code>[画像URL]</code>）で入るので、
        要らなければ保存する前に消せます。
      </p>
    </section>
  </div>
</template>

<style scoped>
.page {
  display: grid;
  gap: 1.5rem;
}

.page__title {
  font-size: 1.125rem;
  margin: 0;
}

.page__lead,
.install__lead,
.use__note {
  margin: 0;
  line-height: 1.7;
  color: var(--text-muted);
}

.install,
.use {
  display: grid;
  gap: 0.75rem;
}

.install__title,
.use__title {
  margin: 0;
  font-size: 0.875rem;
  font-weight: 600;
  color: var(--text-muted);
}

.install__drag {
  margin: 0;
}

/*
 * ブックマークバーに置いたときの見た目に近づけておく。
 * 「押すもの」ではなく「引いて持っていくもの」だと分かるように、
 * 文章の中のリンクとは違う形にする。
 */
.chip {
  display: inline-flex;
  align-items: center;
  min-height: 2.75rem;
  padding: 0 1.25rem;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--surface);
  color: var(--text);
  font-weight: 600;
  text-decoration: none;
  cursor: grab;
}

.install__actions {
  margin: 0;
  display: flex;
  align-items: center;
  gap: 0.75rem;
}

.install__copied {
  font-size: 0.875rem;
  color: var(--text-muted);
}

.button {
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
  cursor: pointer;
}

.use__steps {
  margin: 0;
  padding-left: 1.25rem;
  display: grid;
  gap: 0.375rem;
  line-height: 1.7;
}

code {
  font-size: 0.875em;
  overflow-wrap: anywhere;
}
</style>
