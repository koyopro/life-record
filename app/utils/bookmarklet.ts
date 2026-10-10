/**
 * Amazon の商品ページからタスクを作るブックマークレット
 * （docs/17-bookmarklet.md）。
 *
 * ブックマークレットは**商品ページの中で動く**ので、このアプリのコードを
 * 読み込めない。`javascript:` の中に全部を書き写す必要がある。そこで
 * `amazonIntakeUrl` を関数のまま持ち、`toString()` で文字写しにして
 * `javascript:` に埋める（`buildAmazonBookmarklet`）。
 *
 * そのため **`amazonIntakeUrl` は外の世界に触ってはいけない**。
 * import したもの・このファイルの他の定数を使うと、写した先には存在せず
 * 商品ページで落ちる。使ってよいのは引数と、その中に書いた関数だけ。
 * （逆に言えば、ここに書いてあるものがそのまま動くものなので、
 * テストは `amazonIntakeUrl` をそのまま呼べば確かめられる。）
 */

/**
 * 商品ページから受け口（`/share`）の URL を組み立てる。
 * Amazon の商品ページでなければ null。
 *
 * @param origin このアプリの置き場（`https://example.vercel.app`）
 * @param doc 商品ページ
 * @param href 商品ページの URL
 */
export function amazonIntakeUrl(
  origin: string,
  doc: Document,
  href: string,
): string | null {
  const asin = findAsin()
  if (!asin) return null

  const params = new URLSearchParams()
  params.set('title', findTitle() || asin)
  params.set('url', productUrl(asin))

  // メモには画像だけを入れる。Scrapbox の画像記法（角括弧の URL）で、
  // 1行に1枚（docs/11-scrapbox-notation.md 11.7）
  const images = findImages()
  const note = images.map((src) => `[${src}]`).join('\n')
  if (note) params.set('note', note)

  // 本文（2行目以降。作業記録になる）には、1枚目の画像と商品紹介文を入れる。
  // 一覧のカードに出る抜粋は本文なので、何の商品か一目で分かるようにする
  const body = [images[0] ? `[${images[0]}]` : '', findDescription()]
    .filter(Boolean)
    .join('\n')
  if (body) params.set('text', body)

  return `${origin}/share?${params.toString()}`

  /**
   * ASIN（商品の番号）。URL から取れなければページの中を見る。
   *
   * 検索結果や一覧から開いた URL には `/dp/<ASIN>/ref=...` のように
   * 続きが付くが、要るのは ASIN だけ。
   */
  function findAsin(): string | null {
    const fromPath =
      /\/(?:dp|gp\/product|gp\/aw\/d|product|gp\/offer-listing)\/([A-Z0-9]{10})(?:[/?#]|$)/i.exec(
        href,
      )
    if (fromPath) return fromPath[1]!.toUpperCase()

    // 商品ページでも URL に ASIN が出ない入り方（kindle ストアの一部など）
    const field = doc.querySelector('input#ASIN, input[name="ASIN"]')
    const fromField = field ? (field as HTMLInputElement).value : ''
    if (/^[A-Z0-9]{10}$/i.test(fromField)) return fromField.toUpperCase()

    const canonical = doc.querySelector('link[rel="canonical"]')
    const canonicalHref = canonical ? canonical.getAttribute('href') || '' : ''
    const fromCanonical = /\/(?:dp|product)\/([A-Z0-9]{10})(?:[/?#]|$)/i.exec(
      canonicalHref,
    )
    return fromCanonical ? fromCanonical[1]!.toUpperCase() : null
  }

  /**
   * 商品の URL。見ているホスト（amazon.co.jp / amazon.com）の
   * `/dp/<ASIN>` だけにし、商品名も ref もクエリも付けない。
   */
  function productUrl(id: string): string {
    let host = 'www.amazon.co.jp'
    try {
      const current = new URL(href).hostname
      // 別のサイトの URL を掴まないよう、amazon のホストだけを引き継ぐ
      if (/(^|\.)amazon\.[a-z.]+$/i.test(current)) host = current
    } catch (error) {
      // URL として読めなければ既定のホストにする
    }
    return `https://${host}/dp/${id}`
  }

  /** 本のタイトル。商品ページの見出しを使い、無ければページの題を削る。 */
  function findTitle(): string {
    const heading = doc.querySelector(
      '#productTitle, #ebooksProductTitle, #title span',
    )
    const fromHeading = heading ? heading.textContent || '' : ''
    if (fromHeading.trim()) return clean(fromHeading)

    const og = doc.querySelector('meta[property="og:title"]')
    const fromOg = og ? og.getAttribute('content') || '' : ''
    if (fromOg.trim()) return clean(trimSiteName(fromOg))

    return clean(trimSiteName(doc.title || ''))
  }

  /**
   * ページの題から店の名前を削る。
   *
   * `Amazon.co.jp: 本のタイトル : 著者: 本` のように前後が付く。
   */
  function trimSiteName(value: string): string {
    return value
      .replace(/^Amazon(?:\.co\.jp|\.com)?\s*[:：|｜-]\s*/i, '')
      .replace(/\s*[:：|｜-]\s*Amazon(?:\.co\.jp|\.com)?\s*$/i, '')
  }

  /**
   * 商品紹介文。段落や改行は行として残し、行ごとの空白は詰める。
   *
   * 本なら「内容紹介」（`#bookDescription_feature_div`）、それ以外の
   * 商品は「商品の説明」（`#productDescription`）、どちらも無ければ
   * 箇条書きの特徴（`#feature-bullets`）を使う。
   *
   * 長いものは途中で切る。中身はすべて受け口の URL のクエリに載るため、
   * 長すぎると開けない（置き場の Vercel は URL の長さに上限がある）。
   */
  function findDescription(): string {
    const MAX = 1000
    // 上から順に探す（`querySelector` に並べると、文書の中で先に出る方が
    // 選ばれてしまう。外枠が中身より先に当たり「続きを読む」まで拾う）
    const selectors = [
      '#bookDescription_feature_div .a-expander-content',
      '#bookDescription_feature_div',
      '#productDescription',
      '#feature-bullets ul',
    ]
    let element: Element | null = null
    for (const selector of selectors) {
      element = doc.querySelector(selector)
      if (element && clean(element.textContent || '')) break
      element = null
    }
    if (!element) return ''

    // 区切りの印（行・段落）を改行に直す。続いた区切りは1つにまとめる
    // （隣り合う箇条書きの間に空行ができないように）
    const lines = linesOf(element)
      .replace(/[ \u2028\u2029]*\u2029[ \u2028\u2029]*/g, '\n\n')
      .replace(/[ \u2028]*\u2028[ \u2028]*/g, '\n')
      .split('\n')
      .map(clean)
      .join('\n')
      // 空行は段落の切れ目として1つだけ残す
      .replace(/\n{3,}/g, '\n\n')
      .trim()
    return lines.length > MAX ? `${lines.slice(0, MAX).trim()}…` : lines
  }

  /**
   * 要素の文字を、改行（`<br>`）と段落・箇条書きの区切りを保って読む。
   *
   * 文字の中の改行や続きの空白は、ブラウザの表示と同じく空白1つにする
   * （HTML の書き方による改行を拾わない）。行の区切りは `\u2028`、
   * 段落の区切りは `\u2029` の印にしておき、あとで改行に直す。
   */
  function linesOf(node: Node): string {
    if (node.nodeType === 3) return (node.textContent || '').replace(/\s+/g, ' ')
    if (node.nodeType !== 1) return ''

    const tag = (node as Element).tagName.toLowerCase()
    if (tag === 'br') return '\n'
    if (tag === 'script' || tag === 'style') return ''

    let text = ''
    for (const child of Array.from(node.childNodes)) text += linesOf(child)
    if (tag === 'p') return `\u2029${text}\u2029`
    return /^(div|li|ul|ol|h[1-6])$/.test(tag) ? `\u2028${text}\u2028` : text
  }

  function clean(value: string): string {
    return value.replace(/\s+/g, ' ').trim()
  }

  /**
   * ページに出ている商品の画像。大きい方の URL に直し、重複を除く。
   *
   * 表紙（主画像）を先頭にし、続けて別カットを少しだけ拾う。全部入れると
   * 「なか見！検索」や関連商品まで並び、メモが画像で埋まる。
   */
  function findImages(): string[] {
    const found: string[] = []

    const main = doc.querySelector(
      '#landingImage, #imgBlkFront, #ebooksImgBlkFront, #main-image, #imgTagWrapperId img',
    )
    if (main) {
      // `data-old-hires` は原寸、`data-a-dynamic-image` は大きさごとの一覧
      add((main as HTMLElement).getAttribute('data-old-hires'))
      for (const src of dynamicImages(main as HTMLElement)) add(src)
      add((main as HTMLImageElement).getAttribute('src'))
    }

    const og = doc.querySelector('meta[property="og:image"]')
    if (og) add(og.getAttribute('content'))

    // 別カット（表紙の下に並ぶ小さな画像）。大きい方の URL に直して足す
    for (const thumb of Array.from(doc.querySelectorAll('#altImages img'))) {
      add(thumb.getAttribute('src'))
    }

    return found.slice(0, 4)

    function add(src: string | null): void {
      if (!src) return
      const url = fullSize(src)
      if (!url) return
      if (found.indexOf(url) === -1) found.push(url)
    }
  }

  /** `data-a-dynamic-image`（URL → [幅, 高さ] の表）を大きい順に読む。 */
  function dynamicImages(element: HTMLElement): string[] {
    const raw = element.getAttribute('data-a-dynamic-image')
    if (!raw) return []

    try {
      const map = JSON.parse(raw) as Record<string, number[]>
      return Object.keys(map).sort(
        (a, b) => (map[b]?.[0] ?? 0) - (map[a]?.[0] ?? 0),
      )
    } catch (error) {
      return []
    }
  }

  /**
   * 画像 URL を原寸に直す。商品の画像でなければ null。
   *
   * Amazon の画像 URL は `.../images/I/<画像ID>._SY466_.jpg` のように、
   * 拡張子の手前に大きさの指定が入る。これを外すと原寸になる。
   * ボタンや飾り（`/images/G/`）・データ URL は商品の画像ではないので外す。
   */
  function fullSize(src: string): string | null {
    if (!/^https?:\/\//i.test(src)) return null
    if (!/\/images\/I\//.test(src)) return null

    const match =
      /^(https?:\/\/[^/]+\/images\/I\/[^./?#]+)(?:\.[^/?#]*?)?(\.(?:jpg|jpeg|png|gif))(?:[?#].*)?$/i.exec(
        src,
      )
    return match ? `${match[1]!}${match[2]!.toLowerCase()}` : null
  }
}

/** ブックマークレットで開けなかったときに出す言葉。 */
export const NOT_A_PRODUCT_PAGE =
  'Amazon の商品ページで押してください（商品の番号が見つかりませんでした）'

/**
 * `javascript:` の URL を組み立てる。ブックマークに登録するのはこれ。
 *
 * `amazonIntakeUrl` を文字に写して埋め込み、その場で呼ぶ。空白や引用符が
 * そのままではブックマークに貼りにくいので、URL として読める形にしておく
 * （ブラウザが読み戻してから実行する）。
 *
 * @param origin このアプリの置き場。押した先（/share）はここへ開く
 */
export function buildAmazonBookmarklet(origin: string): string {
  const code = `(function(){
var u=(${amazonIntakeUrl.toString()})(${JSON.stringify(origin)},document,location.href);
if(!u){alert(${JSON.stringify(NOT_A_PRODUCT_PAGE)});return}
if(!window.open(u,'_blank'))location.href=u;
})()`

  return `javascript:${encodeURIComponent(code)}`
}
