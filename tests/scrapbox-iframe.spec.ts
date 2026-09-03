import { describe, expect, it } from 'vitest'
import {
  IFRAME_DEFAULT_HEIGHT,
  iframesIn,
  isIframeUrl,
  parseScrapbox,
} from '~~/shared/utils/scrapbox/parse'
import { renderInline, toPlainText } from '~~/shared/utils/scrapbox/render'

/**
 * 埋め込み（docs/11-scrapbox-notation.md 11.12）。
 *
 * 角括弧で囲んだ URL 単体（`[URL]`）を iframe として出す。`[URL]` は外部
 * リンクの記法でもあるので、**埋め込みにするかはホスト名で決める**。
 * 埋め込む中身が何であるか（囲碁の棋譜など）は見ない。
 */
describe('埋め込み', () => {
  const url = 'https://kifu-lab.vercel.app/s/oicaqrFX8ofL4muP'

  function nodesOf(input: string) {
    const [line] = parseScrapbox(input)
    if (line!.type !== 'text') throw new Error('unreachable')
    return line!.nodes
  }

  it('[URL] は埋め込みになる', () => {
    expect(nodesOf(`[${url}]`)).toEqual([
      { type: 'iframe', url, height: IFRAME_DEFAULT_HEIGHT },
    ])
  })

  it('裸の URL はリンクのまま', () => {
    expect(nodesOf(url)).toEqual([
      { type: 'link', href: url, nodes: [{ type: 'text', value: url }] },
    ])
  })

  it('[URL 表示文字列] はテキストリンクのまま', () => {
    expect(nodesOf(`[${url} 棋譜1]`)).toEqual([
      { type: 'link', href: url, nodes: [{ type: 'text', value: '棋譜1' }] },
    ])
  })

  it('並べていないホストは、これまでどおりリンクとして出す', () => {
    expect(nodesOf('[https://example.com]')).toEqual([
      {
        type: 'link',
        href: 'https://example.com',
        nodes: [{ type: 'text', value: 'https://example.com' }],
      },
    ])
  })

  it('アプリ内のパス・画像は、埋め込みにしない', () => {
    expect(nodesOf('[/diary/2026-08-19]')[0]).toMatchObject({ type: 'link' })
    expect(nodesOf('[/images/a.png]')[0]).toMatchObject({ type: 'image' })
  })

  it('文の途中に書いても、その場で埋め込みになる', () => {
    expect(nodesOf(`きのうの碁 [${url}] を見直す`)).toEqual([
      { type: 'text', value: 'きのうの碁 ' },
      { type: 'iframe', url, height: IFRAME_DEFAULT_HEIGHT },
      { type: 'text', value: ' を見直す' },
    ])
  })

  it('引用・コードブロックの中では、それぞれの扱いのまま', () => {
    const quote = parseScrapbox(`> [${url}]`)[0]!
    if (quote.type !== 'quote') throw new Error('unreachable')
    expect(quote.nodes[0]).toMatchObject({ type: 'iframe' })

    const code = parseScrapbox(`code:sample\n [${url}]`)
    expect(code[1]).toMatchObject({ type: 'codeBody', content: `[${url}]` })
  })

  it('URL は src の属性としてだけ渡す', () => {
    const html = renderInline(nodesOf(`[${url}]`))
    expect(html).toContain(`src="${url}"`)
    expect(html).toContain(`style="height:${IFRAME_DEFAULT_HEIGHT}px"`)
    expect(html).toContain('class="sb-iframe"')
  })

  it('sandbox は要る権限だけを渡す（こちらの画面を動かす権限は渡さない）', () => {
    const html = renderInline(nodesOf(`[${url}]`))
    expect(html).toContain(
      'sandbox="allow-scripts allow-same-origin allow-forms allow-popups"',
    )
    expect(html).not.toContain('allow-top-navigation')
    expect(html).not.toContain('allow-popups-to-escape-sandbox')
  })

  it('URL に記号が混ざっても、HTML として解釈させない', () => {
    const html = renderInline([
      { type: 'iframe', url: 'https://kifu-lab.vercel.app/s/a?b="><script>', height: 600 },
    ])
    expect(html).not.toContain('<script>')
    expect(html).toContain('&quot;&gt;&lt;script&gt;')
  })

  it('抜粋には、書かれた URL をそのまま残す', () => {
    expect(toPlainText(`メモ\n[${url}]`)).toBe(`メモ\n${url}`)
  })

  it('カーソルを置く行の高さを保つために、行の中の埋め込みを取り出せる', () => {
    const line = parseScrapbox(`[${url}] と [${url}]`)[0]!
    expect(iframesIn(line)).toHaveLength(2)
    expect(iframesIn(parseScrapbox('ただの行')[0]!)).toEqual([])
  })
})

/**
 * どの URL を埋め込みにするか。
 *
 * `[URL]` は外部リンクの記法でもあるため、**ホスト名で決める**
 * （どの URL も埋め込みにすると、普通のリンクが書けなくなる）。
 */
describe('埋め込みにする URL', () => {
  it('決めたホストの http(s) だけを通す', () => {
    expect(isIframeUrl('https://kifu-lab.vercel.app/s/xSEDBw9C7N8kkXeX')).toBe(true)
    expect(isIframeUrl('https://kifu.tsumego.jp/s/xSEDBw9C7N8kkXeX')).toBe(true)
    expect(isIframeUrl(' https://kifu.tsumego.jp/s/x ')).toBe(true)
    expect(isIframeUrl('http://kifu.tsumego.jp/s/x')).toBe(true)

    expect(isIframeUrl('https://example.com')).toBe(false)
    // ホスト名の一部に紛れ込ませても通さない
    expect(isIframeUrl('https://kifu.tsumego.jp.example.com/s/x')).toBe(false)
    expect(isIframeUrl('https://evil.com/?x=kifu.tsumego.jp')).toBe(false)
    expect(isIframeUrl('javascript:alert(1)')).toBe(false)
    expect(isIframeUrl('/items/1')).toBe(false)
  })
})
