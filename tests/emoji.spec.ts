import { describe, expect, it } from 'vitest'
import { iconInsertion, searchEmoji } from '~~/shared/utils/emoji'

/**
 * 本文エディタの絵文字候補（`:` で出す、docs/11-scrapbox-notation.md とは別枠）。
 *
 * 記法としては保存せず、選んだ時点で実際の絵文字に置き換えるため、
 * ここでは検索ロジック（ショートコードの前方一致・部分一致）だけ確かめる。
 */
describe('searchEmoji', () => {
  it('空のクエリでは、よく使うものを先頭から返す', () => {
    const result = searchEmoji('', 3)
    expect(result).toHaveLength(3)
    expect(result[0]!.char).toBe('😀')
  })

  it('ショートコードの前方一致を優先する', () => {
    const result = searchEmoji('fire')
    expect(result[0]).toMatchObject({ char: '🔥', name: 'fire' })
  })

  it('前方一致が無ければ部分一致・キーワードで探す', () => {
    const result = searchEmoji('泣く')
    expect(result.some((entry) => entry.char === '😭')).toBe(true)
  })

  it('該当が無ければ空配列を返す', () => {
    expect(searchEmoji('xyz123notanemoji')).toEqual([])
  })

  it('limit を超えない', () => {
    expect(searchEmoji('a', 2)).toHaveLength(2)
  })
})

/**
 * アイコンを選んだときに差し込む文字列（docs/11-scrapbox-notation.md 11.8）。
 *
 * 閉じの `:` が次の文字とくっついたままだと、候補は `:` から始まる語を見て
 * 出すため、続けて打った文字が次のアイコン名として拾われてしまう。
 */
describe('iconInsertion', () => {
  it('閉じの `:` の後ろに半角スペースを足す', () => {
    expect(iconInsertion('star')).toBe(':star: ')
  })

  it('行の途中（後ろに文字が続く）でも足す', () => {
    expect(iconInsertion('star', 'のあと')).toBe(':star: ')
  })

  it('後ろがすでに空白なら足さない（選ぶたびに増やさない）', () => {
    expect(iconInsertion('star', ' つづき')).toBe(':star:')
    expect(iconInsertion('star', '\u3000つづき')).toBe(':star:')
  })
})
