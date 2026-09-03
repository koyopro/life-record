import { describe, expect, it } from 'vitest'
import {
  IFRAME_DEFAULT_HEIGHT,
  iframeNotation,
  isIframeUrl,
  parseScrapbox,
} from '~~/shared/utils/scrapbox/parse'
import { lineClass, renderLine, toPlainText } from '~~/shared/utils/scrapbox/render'
import { insertIframeLines } from '~/utils/iframe-insert'

/**
 * 埋め込み（docs/11-scrapbox-notation.md 11.12）。
 *
 * 任意の外部ページを `iframe:URL` の行として埋め込む。囲碁の棋譜など、
 * 埋め込む先が何であるかはこちらでは見ない（汎用の記法にする）。
 */
describe('埋め込みの行', () => {
  const url = 'https://kifu.tsumego.jp/s/xSEDBw9C7N8kkXeX'

  it('`iframe:URL` を埋め込みの行として扱う', () => {
    const line = parseScrapbox(`iframe:${url}`)[0]!
    expect(line).toMatchObject({
      type: 'iframe',
      indent: 0,
      prefix: 'iframe:',
      content: url,
      url,
      height: IFRAME_DEFAULT_HEIGHT,
    })
    // 行頭 + 中身は、書かれたままの行に戻る（カーソルを置けば直せる）
    expect(line.prefix + line.content).toBe(line.raw)
  })

  it('高さを指定できる。範囲の外・知らない指定は無視する', () => {
    expect(parseScrapbox(`iframe:${url} height=600`)[0]).toMatchObject({ height: 600 })
    expect(parseScrapbox(`iframe:${url} height=1`)[0]).toMatchObject({
      height: IFRAME_DEFAULT_HEIGHT,
    })
    expect(parseScrapbox(`iframe:${url} width=300`)[0]).toMatchObject({
      type: 'iframe',
      url,
      height: IFRAME_DEFAULT_HEIGHT,
    })
  })

  it('http(s) でなければ、ただの文字のまま', () => {
    expect(parseScrapbox('iframe:javascript:alert(1)')[0]).toMatchObject({ type: 'text' })
    expect(parseScrapbox('iframe:/items/1')[0]).toMatchObject({ type: 'text' })
    expect(parseScrapbox('iframe:これから書く')[0]).toMatchObject({ type: 'text' })
    expect(parseScrapbox('iframe:')[0]).toMatchObject({ type: 'text' })
  })

  it('字下げした行でも埋め込みになり、字下げは行頭に残る', () => {
    const line = parseScrapbox(`  iframe:${url}`)[0]!
    expect(line).toMatchObject({ type: 'iframe', indent: 2, prefix: '  iframe:', url })
    expect(line.prefix + line.content).toBe(line.raw)
  })

  it('コードブロックの中では、中身のまま（埋め込みにしない）', () => {
    const lines = parseScrapbox(`code:sample\n iframe:${url}`)
    expect(lines[1]).toMatchObject({ type: 'codeBody', content: `iframe:${url}` })
  })

  it('前後の行はそのまま。1行が1要素の対応も崩さない', () => {
    const lines = parseScrapbox(`前の行\niframe:${url}\n次の行`)
    expect(lines.map((line) => line.type)).toEqual(['text', 'iframe', 'text'])
  })

  it('URL は src の属性としてだけ渡す', () => {
    const line = parseScrapbox(`iframe:${url}`)[0]!
    const html = renderLine(line)
    expect(html).toContain(`src="${url}"`)
    expect(html).toContain(`style="height:${IFRAME_DEFAULT_HEIGHT}px"`)
    expect(lineClass(line)).toContain('sb-line--iframe')
  })

  it('sandbox は要る権限だけを渡す（こちらの画面を動かす権限は渡さない）', () => {
    const html = renderLine(parseScrapbox(`iframe:${url}`)[0]!)
    expect(html).toContain(
      'sandbox="allow-scripts allow-same-origin allow-forms allow-popups"',
    )
    expect(html).not.toContain('allow-top-navigation')
    expect(html).not.toContain('allow-popups-to-escape-sandbox')
  })

  it('URL に記号が混ざっても、HTML として解釈させない', () => {
    const html = renderLine(parseScrapbox('iframe:https://example.com/?a="><script>')[0]!)
    expect(html).not.toContain('<script>')
    expect(html).toContain('&quot;&gt;&lt;script&gt;')
  })

  it('抜粋には、書かれた URL をそのまま残す', () => {
    expect(toPlainText(`メモ\niframe:${url}`)).toBe(`メモ\n${url}`)
  })
})

/**
 * URL の判定。**特定のドメインだけを許す作りにはしない**（任意の外部
 * ページを埋め込むための記法のため）。
 */
describe('埋め込みに使える URL', () => {
  it('http(s) のものだけを通す', () => {
    expect(isIframeUrl('https://example.com')).toBe(true)
    expect(isIframeUrl('http://example.com/a?b=c')).toBe(true)
    expect(isIframeUrl(' https://example.com ')).toBe(true)
    expect(isIframeUrl('javascript:alert(1)')).toBe(false)
    expect(isIframeUrl('data:text/html,<script>alert(1)</script>')).toBe(false)
    expect(isIframeUrl('/items/1')).toBe(false)
    expect(isIframeUrl('example.com')).toBe(false)
  })
})

/**
 * 差し込み（app/utils/iframe-insert.ts）。
 *
 * `iframe:` は行の種類を決める行頭なので、**必ず1行として置く**。
 */
describe('埋め込みの差し込み', () => {
  const url = 'https://example.com/a'
  const notation = `iframe:${url}`

  it('記法は URL をそのまま囲む', () => {
    expect(iframeNotation(` ${url} `)).toBe(notation)
  })

  it('カーソルが無ければ末尾に足す', () => {
    const inserted = insertIframeLines(['メモ'], null, url)
    expect(inserted.lines).toEqual(['メモ', notation])
    expect(inserted).toMatchObject({ index: 1, added: 1 })
  })

  it('何も書かれていない行は、その行が埋め込みになる', () => {
    const inserted = insertIframeLines(['メモ', ''], { index: 1, offset: 0 }, url)
    expect(inserted.lines).toEqual(['メモ', notation])
    expect(inserted).toMatchObject({ index: 1, added: 0 })
  })

  it('行の途中では、前後に割って間に入れる', () => {
    const inserted = insertIframeLines(['前後'], { index: 0, offset: 1 }, url)
    expect(inserted.lines).toEqual(['前', notation, '後'])
    expect(inserted).toMatchObject({ index: 1, added: 2 })
  })

  it('行の末尾でも、その行には続けず次の行に置く', () => {
    const inserted = insertIframeLines(['メモ'], { index: 0, offset: 2 }, url)
    expect(inserted.lines).toEqual(['メモ', notation])
    expect(inserted).toMatchObject({ index: 1, added: 1 })
  })

  it('字下げした行では、その字下げを引き継ぐ', () => {
    const inserted = insertIframeLines(['買い物', '  牛乳'], { index: 1, offset: 2 }, url)
    expect(inserted.lines).toEqual(['買い物', '  牛乳', `  ${notation}`])
  })
})
