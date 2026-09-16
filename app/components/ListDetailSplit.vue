<script setup lang="ts">
/**
 * 一覧（左）と詳細（右）の分割（docs/03-functional-spec.md 3.1）。
 *
 * 画面が広ければ、一覧を左に残したまま右側に詳細を出す。タスク一覧
 * （`ItemListView`）と検索結果（`app/pages/search.vue`）で同じ形にするため、
 * 幅の取り方と詳細側のスクロールをここに1つだけ置く。
 *
 * 中身は持たない。左に何を並べるか・右に何を出すかは呼ぶ側が決める
 * （検索結果には、タスクの詳細を出せない行――日記――も混ざるため）。
 */
defineProps<{
  /**
   * 右ペインを出すか。
   *
   * 幅の判定（`useSplitLayout`）と「出すものがあるか」は呼ぶ側が持つ。
   * 出していないあいだは、一覧を読みやすい幅（40rem）に収める。
   */
  active: boolean
}>()
</script>

<template>
  <div class="split" :class="{ 'split--active': active }">
    <div class="split__list">
      <slot />
    </div>

    <aside v-if="active" class="split__detail">
      <slot name="detail" />
    </aside>
  </div>
</template>

<style scoped>
/*
 * 詳細が出ていないときは、読みやすい幅に収める。画面（.shell--wide）は
 * 分割のために広げてあるので、ここで戻さないと一覧だけが間延びする。
 */
.split {
  display: grid;
  gap: 1.5rem;
  max-width: 40rem;
}

@media (min-width: 60rem) {
  .split--active {
    max-width: none;
    grid-template-columns: minmax(0, 22rem) minmax(0, 1fr);
    align-items: start;
  }

  /* 詳細は別スクロール。長い本文を読んでも一覧の位置が動かない */
  .split--active .split__detail {
    position: sticky;
    top: 1rem;
    max-height: calc(100vh - 2rem);
    overflow-y: auto;
    /*
     * バーのぶんは、出ていないあいだも空けておく（main.css の html と同じ。
     * docs/16-macos-app.md 16.11）。
     * `j` / `k` で送るとタスクごとに本文の長さが変わり、作業記録の長い
     * タスクでだけバーが出る。空けておかないと、そのタスクに当たるたびに
     * 詳細の中身が横へずれる。
     */
    scrollbar-gutter: stable;
    padding-right: 0.25rem;
  }

  /* `scrollbar-gutter` を知らない WebKit 向け（main.css の html と同じ） */
  @supports not (scrollbar-gutter: stable) {
    .split--active .split__detail {
      overflow-y: scroll;
    }
  }
}

/*
 * 列は必ず親の幅に収める。既定（auto）だと、中身のいちばん広いもの
 * （並び替えのセレクトなど）の最小幅まで列が広がり、分割表示で
 * 一覧が詳細に重なる。はみ出させず、中身のほうを折り返させる。
 */
.split__list {
  min-width: 0;
}

.split__detail {
  min-width: 0;
  border-left: 1px solid var(--border);
  padding-left: 1.5rem;
}
</style>
