/**
 * 画面キーボード（スマートフォンのソフトウェアキーボード）が出ているか。
 *
 * 下端に固定しているボタン（☰・＋）は、キーボードが出ると表示領域が
 * 縮むぶん入力欄やその操作ボタンに重なる。入力中は要らないので退ける。
 *
 * キーボードの有無を直接知る手段は無いので、次の2つがそろったときに
 * 「出ている」とみなす。
 *
 * - 文字を入力できる要素にフォーカスがある
 * - 表示領域の高さが画面の高さより大きく縮んでいる
 *
 * viewport に interactive-widget=resizes-content を指定している
 * （nuxt.config.ts）ので、キーボードが出ると innerHeight そのものが縮む。
 * フォーカスだけで決めないのは、Android の「戻る」でキーボードだけを
 * 閉じたときにフォーカスが残るため。高さだけで決めないのは、画面分割や
 * 小さなウィンドウで常に隠れてしまうのを避けるため。
 */

/** 画面の高さに対して、これより縮んでいればキーボードが出ているとみなす。 */
const SHRINK_RATIO = 0.75;

function isEditable(element: Element | null): boolean {
  if (!element) return false;
  if (element instanceof HTMLTextAreaElement) return !element.readOnly;
  if (element instanceof HTMLInputElement) {
    const nonText = [
      "button",
      "checkbox",
      "color",
      "file",
      "hidden",
      "image",
      "radio",
      "range",
      "reset",
      "submit",
    ];
    return !element.readOnly && !nonText.includes(element.type);
  }
  return element instanceof HTMLElement && element.isContentEditable;
}

export function useVirtualKeyboard() {
  // サーバー描画時は出ていない扱い。ハイドレーション後に実際の値へ切り替わる。
  const open = ref(false);

  onMounted(() => {
    const update = () => {
      const height = window.visualViewport?.height ?? window.innerHeight;
      const shrunk = height < window.screen.height * SHRINK_RATIO;
      open.value = shrunk && isEditable(document.activeElement);
    };

    // フォーカスの移り先は focusout の時点ではまだ決まっていないので、一拍置く
    const deferred = () => setTimeout(update, 0);

    update();
    document.addEventListener("focusin", update);
    document.addEventListener("focusout", deferred);
    window.addEventListener("resize", update);
    window.visualViewport?.addEventListener("resize", update);

    onUnmounted(() => {
      document.removeEventListener("focusin", update);
      document.removeEventListener("focusout", deferred);
      window.removeEventListener("resize", update);
      window.visualViewport?.removeEventListener("resize", update);
    });
  });

  return open;
}
