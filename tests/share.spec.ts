import { describe, expect, it } from 'vitest'
import { composeShare, hasSharedContent } from '~~/shared/utils/share'
import { parseSmartAdd } from '~~/shared/utils/smart-add'
import { splitInput } from '~~/shared/utils/text'

/**
 * 共有シートから受け取った内容の組み立て（docs/13-share-target.md）。
 *
 * 共有元によって渡されるものが違うため、組み合わせごとに
 * 「何が Item のタイトル・url・本文になるか」を確かめる。
 */

/** 組み立てたテキストを、実際に保存されるときと同じ手順で解釈する。 */
function asItem(text: string) {
  const split = splitInput(text)
  const parsed = split ? parseSmartAdd(split.titleLine) : null
  return {
    title: parsed?.title ?? '',
    url: parsed?.url ?? null,
    body: split?.body ?? null,
  }
}

describe('composeShare', () => {
  it('URL とタイトルを受け取ったら、タイトルの後ろに URL を置く', () => {
    const composed = composeShare({
      url: 'https://example.com/a',
      title: 'Example Page',
    })

    expect(composed.url).toBe('https://example.com/a')
    expect(composed.text).toBe('Example Page https://example.com/a')
    expect(asItem(composed.text)).toEqual({
      title: 'Example Page',
      url: 'https://example.com/a',
      body: null,
    })
  })

  it('タイトルが無ければ URL からタイトルを作る', () => {
    const composed = composeShare({ url: 'https://example.com/blog/entry?id=1' })

    expect(asItem(composed.text)).toEqual({
      title: 'example.com/blog/entry',
      url: 'https://example.com/blog/entry?id=1',
      body: null,
    })
  })

  it('text が URL の写しでしかないなら、本文には残さない', () => {
    const composed = composeShare({
      url: 'https://example.com/a',
      text: 'https://example.com/a',
    })

    expect(composed.text).toBe('example.com/a https://example.com/a')
    expect(asItem(composed.text).body).toBeNull()
  })

  it('text がタイトルの写しでしかないなら、本文には残さない', () => {
    const composed = composeShare({
      url: 'https://example.com/a',
      title: 'Example Page',
      text: 'Example Page',
    })

    expect(composed.text).toBe('Example Page https://example.com/a')
  })

  it('URL と一緒に来た text は本文として残す', () => {
    const composed = composeShare({
      url: 'https://example.com/a',
      title: 'Example Page',
      text: '引用したい一節',
    })

    expect(asItem(composed.text)).toEqual({
      title: 'Example Page',
      url: 'https://example.com/a',
      body: '引用したい一節',
    })
  })

  it('タイトルが無く text だけ来たら、text をタイトルに繰り上げる', () => {
    const composed = composeShare({
      url: 'https://example.com/a',
      text: '読み返したい記事',
    })

    expect(asItem(composed.text)).toEqual({
      title: '読み返したい記事',
      url: 'https://example.com/a',
      body: null,
    })
  })

  it('text の中の URL を url として取り出し、本文には重ねて残さない', () => {
    const composed = composeShare({ text: '面白い記事 https://example.com/a' })

    expect(composed.url).toBe('https://example.com/a')
    expect(asItem(composed.text)).toEqual({
      title: '面白い記事',
      url: 'https://example.com/a',
      body: null,
    })
  })

  it('URL を含まない text は、1行目をタイトル・以降を本文にする', () => {
    const composed = composeShare({ text: '買い物メモ\n牛乳\n卵' })

    expect(composed.url).toBeNull()
    expect(asItem(composed.text)).toEqual({
      title: '買い物メモ',
      url: null,
      body: '牛乳\n卵',
    })
  })

  it('URL が無くタイトルだけでも組み立てられる', () => {
    const composed = composeShare({ title: 'Example Page' })

    expect(composed.text).toBe('Example Page')
    expect(composed.url).toBeNull()
  })

  it('空文字のタイトルは無いものとして扱う', () => {
    const composed = composeShare({ url: 'https://example.com/a', title: '   ' })

    expect(asItem(composed.text).title).toBe('example.com/a')
  })

  it('URL として読めない url は url 欄に入れない', () => {
    const composed = composeShare({ url: 'content://media/1', title: '写真' })

    expect(composed.url).toBeNull()
    expect(composed.text).toBe('写真')
  })

  it('複数行の text でも、URL と一緒なら全体を本文に残す', () => {
    const composed = composeShare({
      url: 'https://example.com/a',
      title: 'Example Page',
      text: '一行目\n二行目',
    })

    expect(asItem(composed.text).body).toBe('一行目\n二行目')
  })
})

describe('hasSharedContent', () => {
  it('どれか1つでも中身があれば受け付ける', () => {
    expect(hasSharedContent({ url: 'https://example.com/a' })).toBe(true)
    expect(hasSharedContent({ title: 'Example' })).toBe(true)
    expect(hasSharedContent({ text: 'メモ' })).toBe(true)
  })

  it('何も無い・空白だけなら受け付けない', () => {
    expect(hasSharedContent({})).toBe(false)
    expect(hasSharedContent({ url: '', title: ' ', text: '\n' })).toBe(false)
  })
})
