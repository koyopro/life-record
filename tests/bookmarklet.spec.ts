import { describe, expect, it } from 'vitest'
import {
  amazonIntakeUrl,
  buildAmazonBookmarklet,
} from '~/utils/bookmarklet'

/**
 * Amazon の商品ページからタスクを作るブックマークレット
 * （docs/17-bookmarklet.md）。
 *
 * `amazonIntakeUrl` はブックマークレットに写して商品ページの中で動く
 * ものそのものなので、ここでは偽の商品ページを組み立てて直接呼ぶ。
 */

const ORIGIN = 'https://datalake.example'

/** 商品ページのうち、ここで使うところだけを組み立てる。 */
function productPage(
  html: string,
  options: { title?: string } = {},
): Document {
  const doc = document.implementation.createHTMLDocument()
  doc.title = options.title ?? 'Amazon.co.jp: サンプル'
  doc.body.innerHTML = html
  return doc
}

/** 受け口（/share）の URL から、渡されたクエリを読み直す。 */
function intakeQuery(url: string | null) {
  if (!url) return null
  const parsed = new URL(url)
  return {
    path: `${parsed.origin}${parsed.pathname}`,
    title: parsed.searchParams.get('title'),
    url: parsed.searchParams.get('url'),
    note: parsed.searchParams.get('note'),
  }
}

describe('amazonIntakeUrl', () => {
  it('商品ページから、タイトル・短い URL・画像のメモを組み立てる', () => {
    const doc = productPage(`
      <span id="productTitle">  リーダブルコード\n </span>
      <img id="landingImage"
           src="https://m.media-amazon.com/images/I/51AbCdEf._SY291_.jpg">
    `)

    const intake = intakeQuery(
      amazonIntakeUrl(
        ORIGIN,
        doc,
        'https://www.amazon.co.jp/リーダブルコード/dp/B06XC33Q6S/ref=sr_1_1?keywords=abc',
      ),
    )

    expect(intake).toEqual({
      path: `${ORIGIN}/share`,
      // 改行や続きの空白は詰める
      title: 'リーダブルコード',
      // 商品名も ref= もクエリも落とし、/dp/<ASIN> だけにする
      url: 'https://www.amazon.co.jp/dp/B06XC33Q6S',
      // 画像は Scrapbox の画像記法で、大きさの指定（._SY291_）を外して入れる
      note: '[https://m.media-amazon.com/images/I/51AbCdEf.jpg]',
    })
  })

  it('/gp/product/<ASIN> の形でも同じ URL にする', () => {
    const intake = intakeQuery(
      amazonIntakeUrl(
        ORIGIN,
        productPage('<span id="productTitle">本</span>'),
        'https://www.amazon.co.jp/gp/product/B06XC33Q6S?psc=1',
      ),
    )

    expect(intake?.url).toBe('https://www.amazon.co.jp/dp/B06XC33Q6S')
  })

  it('URL に商品の番号が無ければ、ページの中から拾う', () => {
    const intake = intakeQuery(
      amazonIntakeUrl(
        ORIGIN,
        productPage(`
          <span id="productTitle">本</span>
          <input type="hidden" id="ASIN" value="b06xc33q6s">
        `),
        'https://www.amazon.co.jp/kindle-dbs/entity/author/XXXX',
      ),
    )

    // 小文字で入っていても、URL は大文字の ASIN にそろえる
    expect(intake?.url).toBe('https://www.amazon.co.jp/dp/B06XC33Q6S')
  })

  it('見ているホスト（amazon.com）はそのまま引き継ぐ', () => {
    const intake = intakeQuery(
      amazonIntakeUrl(
        ORIGIN,
        productPage('<span id="productTitle">Book</span>'),
        'https://www.amazon.com/dp/B06XC33Q6S',
      ),
    )

    expect(intake?.url).toBe('https://www.amazon.com/dp/B06XC33Q6S')
  })

  it('商品の番号が見つからなければ何も作らない', () => {
    const url = amazonIntakeUrl(
      ORIGIN,
      productPage('<h1>いらっしゃいませ</h1>'),
      'https://www.amazon.co.jp/',
    )

    expect(url).toBeNull()
  })

  it('原寸（data-old-hires）があればそちらを使う', () => {
    const doc = productPage(`
      <span id="productTitle">本</span>
      <img id="landingImage"
           data-old-hires="https://m.media-amazon.com/images/I/91Full.jpg"
           src="https://m.media-amazon.com/images/I/51Small._SY291_.jpg">
    `)

    const intake = intakeQuery(
      amazonIntakeUrl(ORIGIN, doc, 'https://www.amazon.co.jp/dp/B06XC33Q6S'),
    )

    expect(intake?.note?.split('\n')[0]).toBe(
      '[https://m.media-amazon.com/images/I/91Full.jpg]',
    )
  })

  it('別カットも拾うが、同じ画像は一度だけ・多すぎないようにする', () => {
    const thumbs = [1, 2, 3, 4, 5, 6]
      .map(
        (n) =>
          `<img src="https://m.media-amazon.com/images/I/7${n}Alt._SS40_.jpg">`,
      )
      .join('')
    const doc = productPage(`
      <span id="productTitle">本</span>
      <img id="landingImage"
           src="https://m.media-amazon.com/images/I/71Alt._SY466_.jpg">
      <div id="altImages">${thumbs}</div>
    `)

    const intake = intakeQuery(
      amazonIntakeUrl(ORIGIN, doc, 'https://www.amazon.co.jp/dp/B06XC33Q6S'),
    )
    const lines = intake?.note?.split('\n') ?? []

    expect(lines).toHaveLength(4)
    expect(new Set(lines).size).toBe(4)
    // 表紙（主画像）が先頭。別カットはそのあとに続く
    expect(lines[0]).toBe('[https://m.media-amazon.com/images/I/71Alt.jpg]')
    expect(lines[1]).toBe('[https://m.media-amazon.com/images/I/72Alt.jpg]')
  })

  it('商品の画像でないもの（飾り・データURL）は入れない', () => {
    const doc = productPage(`
      <span id="productTitle">本</span>
      <img id="landingImage" src="data:image/gif;base64,R0lGODlhAQABAAAAACw=">
      <div id="altImages">
        <img src="https://m.media-amazon.com/images/G/09/button._V1_.png">
      </div>
    `)

    const intake = intakeQuery(
      amazonIntakeUrl(ORIGIN, doc, 'https://www.amazon.co.jp/dp/B06XC33Q6S'),
    )

    // 画像が無ければメモは付けない
    expect(intake?.note).toBeNull()
  })

  it('見出しが無ければページの題から店の名前を落とす', () => {
    const doc = productPage('<div>中身</div>', {
      title: 'Amazon.co.jp: リーダブルコード : 著者: 本',
    })

    const intake = intakeQuery(
      amazonIntakeUrl(ORIGIN, doc, 'https://www.amazon.co.jp/dp/B06XC33Q6S'),
    )

    expect(intake?.title).toBe('リーダブルコード : 著者: 本')
  })
})

describe('buildAmazonBookmarklet', () => {
  it('javascript: の中で、そのまま動く形に写す', () => {
    const bookmarklet = buildAmazonBookmarklet(ORIGIN)

    expect(bookmarklet.startsWith('javascript:')).toBe(true)

    const code = decodeURIComponent(bookmarklet.slice('javascript:'.length))
    // 開く先（このアプリの置き場）が埋まっている
    expect(code).toContain(JSON.stringify(ORIGIN))
    // 商品ページ側にはアプリのコードが無いので、写しに import は残せない
    expect(code).not.toContain('import')

    // 写したものを商品ページの中で動かすと、受け口の URL が返る
    const doc = productPage('<span id="productTitle">本</span>')
    const opened: string[] = []
    // 商品ページの中にいるつもりで動かす（document / location / window を渡す）
    const run = new Function('document', 'location', 'window', 'alert', code)

    run(
      doc,
      { href: 'https://www.amazon.co.jp/dp/B06XC33Q6S' },
      {
        open: (url: string) => {
          opened.push(url)
          // 開けた（＝ location.href への差し替えには回らない）
          return {}
        },
      },
      () => {},
    )

    expect(intakeQuery(opened[0] ?? null)).toMatchObject({
      path: `${ORIGIN}/share`,
      title: '本',
      url: 'https://www.amazon.co.jp/dp/B06XC33Q6S',
    })
  })
})
