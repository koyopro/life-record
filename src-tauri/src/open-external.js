/*
 * 別のタブ・ウィンドウを開こうとする移動を、同じウィンドウの移動に置き換える。
 *
 * 普通のリンクや location の書き換えは、Rust 側の on_navigation が必ず通る。
 * だが target="_blank" と window.open() は WKWebView では「新しいウィンドウを
 * 作ってよいか」の問い合わせになり、そこを通らないことがある。この2つだけを
 * ここで拾い、同じウィンドウの移動へ直して Rust 側の判定に載せる。
 *
 * 外部 URL ならその移動は取り消され、macOS の既定のブラウザが開く。
 * 開く・開かないを決めるのはあくまで Rust 側で、ここでは判定しない。
 *
 * このファイルは Tauri のウィンドウにだけ注入される。ブラウザで開く Web 版
 * には入らないので、そちらのふるまいは変わらない。
 */
;(function () {
  if (window.__lifeRecordOpenExternal) return
  window.__lifeRecordOpenExternal = true

  /** Rust 側の判定へ渡す。 */
  function handOver(url) {
    var absolute
    try {
      absolute = new URL(String(url), window.location.href).href
    } catch (error) {
      // URL として読めないものは何もしない
      return
    }
    window.location.href = absolute
  }

  /** 別のタブ・ウィンドウで開こうとしているリンクか。 */
  function opensNewWindow(anchor) {
    var target = anchor.target
    if (!target) return false
    return target !== '_self' && target !== '_top' && target !== '_parent'
  }

  /*
   * 画面側が preventDefault したものには手を出さない（本文エディタなど、
   * リンクのクリックを自分で処理している箇所がある）。そのため捕捉ではなく
   * 浮上の段階で受ける。
   */
  document.addEventListener('click', function (event) {
    if (event.defaultPrevented || event.button !== 0) return

    var element = event.target
    if (!element || typeof element.closest !== 'function') return

    var anchor = element.closest('a[href]')
    if (!anchor || !opensNewWindow(anchor)) return

    event.preventDefault()
    // anchor.href は相対でも絶対 URL として読める
    handOver(anchor.href)
  })

  var nativeOpen = window.open
  window.open = function (url, name, features) {
    // 行き先のない window.open() は素のふるまいに任せる
    if (url === undefined || url === null || url === '') {
      return nativeOpen.call(window, url, name, features)
    }
    handOver(url)
    // 開いた先の window は返せない。呼び出し側（ItemListView）は見ていない
    return null
  }
})()
