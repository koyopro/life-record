/**
 * いま一覧で何件チェックされているか。
 *
 * 選択中は下端に操作の帯（SelectionBar）が出るため、同じ場所にある
 * 「＋」（app.vue）を退ける必要がある。両者は親子ではないので、
 * 画面をまたぐ状態として持つ。
 *
 * 初期値は 0 で、変わるのは操作してからなので、サーバー描画とは食い違わない。
 */
export function useSelectionCount() {
  return useState('list:selection-count', () => 0)
}
