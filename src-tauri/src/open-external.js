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
 * 一度に何件も渡されることがある（一覧の `Shift`+`u` は、チェックしたタスクの
 * 数だけ window.open() を呼ぶ）。移動は1つしか持てないので、続けて location を
 * 書き換えると最後の1つに上書きされ、1件しか開かない。同じ流れで渡された分は
 * **1回の移動にまとめ**、Rust 側で1つずつ判定して開く。
 *
 * このファイルは Tauri のウィンドウにだけ注入される。ブラウザで開く Web 版
 * には入らないので、そちらのふるまいは変わらない。
 */
;(function () {
  if (window.__lifeRecordOpenExternal) return
  window.__lifeRecordOpenExternal = true

  /**
   * まとめて渡すための道（Rust 側の `url_rules.rs` と揃える）。
   *
   * ここへの移動は必ず取り消されるので、この道のページは要らない。
   * 自分と同じ origin に置くのは、外部のページが騙っても拾わないため。
   */
  var BATCH_PATH = '/__open-external'

  /** まだ渡していない URL。同じ流れで呼ばれた分がここにたまる。 */
  var queued = []

  /** Rust 側の判定へ渡す。 */
  function handOver(url) {
    var absolute
    try {
      absolute = new URL(String(url), window.location.href).href
    } catch (error) {
      // URL として読めないものは何もしない
      return
    }

    queued.push(absolute)
    // 予約は1件目のときだけ。同じ流れで続く分は、この1回の移動に乗る
    if (queued.length === 1) setTimeout(flush, 0)
  }

  /** たまった分を1回の移動に載せる。 */
  function flush() {
    var urls = queued
    queued = []
    if (urls.length === 0) return
    window.location.href = urls.length === 1 ? urls[0] : batchUrl(urls)
  }

  /** 何件かをまとめて渡すための URL。読むのは Rust 側だけ。 */
  function batchUrl(urls) {
    var query = urls
      .map(function (url) {
        return 'url=' + encodeURIComponent(url)
      })
      .join('&')
    return new URL(BATCH_PATH + '?' + query, window.location.href).href
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
