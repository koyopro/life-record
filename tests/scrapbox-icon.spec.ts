import { describe, expect, it } from 'vitest'
import { parseScrapbox } from '~~/shared/utils/scrapbox/parse'
import { renderLine, toPlainText } from '~~/shared/utils/scrapbox/render'
import { normalizeIconName, iconNameFromFileName } from '~~/shared/types/icon'

const ICONS = { hoge: '/images/11111111-1111-1111-1111-111111111111.png' }

function nodesOf(input: string) {
  const [line] = parseScrapbox(input)
  if (line!.type !== 'text') throw new Error('unreachable')
  return line!.nodes
}

function html(input: string, icons?: Record<string, string>) {
  const [line] = parseScrapbox(input)
  return renderLine(line!, { icons })
}

/**
 * 自分で登録したアイコン（docs/11-scrapbox-notation.md 11.8）。
 *
 * 記法を読む時点では登録の有無が分からないため、形だけを取って
 * 画像にするかどうかは描画側で決める。
 */
describe(':name: のアイコン', () => {
  it('`:hoge:` はアイコンとして取り出される', () => {
    expect(nodesOf('やった :hoge:')).toEqual([
      { type: 'text', value: 'やった ' },
      { type: 'icon', name: 'hoge', raw: ':hoge:' },
    ])
  })

  it('登録されていれば画像になる', () => {
    expect(html(':hoge:', ICONS)).toContain(`src="${ICONS.hoge}"`)
    expect(html(':hoge:', ICONS)).toContain('class="sb-icon"')
  })

  it('登録が無ければ、書かれたままの文字で出る', () => {
    expect(html(':hoge:')).toBe(':hoge:')
    expect(html(':unknown:', ICONS)).toBe(':unknown:')
  })

  it('大文字で書いても引ける。出せないときは書いた形のまま残す', () => {
    expect(nodesOf(':Hoge:')).toEqual([{ type: 'icon', name: 'hoge', raw: ':Hoge:' }])
    expect(html(':Hoge:', ICONS)).toContain(`src="${ICONS.hoge}"`)
    expect(html(':Hoge:')).toBe(':Hoge:')
  })

  it('時刻のような文章を壊さない', () => {
    // `:30:` はアイコンの形に当てはまるが、登録が無いので文字のまま出る
    expect(html('12:30:45')).toBe('12:30:45')
  })

  it('コードの中では記法として扱わない', () => {
    expect(nodesOf('`:hoge:`')).toEqual([{ type: 'code', value: ':hoge:' }])
  })

  it('抜粋（toPlainText）では書かれたままにする', () => {
    expect(toPlainText('おはよう :hoge:')).toBe('おはよう :hoge:')
  })
})

describe('アイコンの名前', () => {
  it('前後の `:` を外し、小文字にそろえる', () => {
    expect(normalizeIconName(':Hoge:')).toBe('hoge')
    expect(normalizeIconName(' HOGE ')).toBe('hoge')
  })

  it('使えない文字・長さは受け付けない', () => {
    expect(normalizeIconName('')).toBeNull()
    expect(normalizeIconName('ほげ')).toBeNull()
    expect(normalizeIconName('a b')).toBeNull()
    expect(normalizeIconName('a'.repeat(33))).toBeNull()
  })

  it('ファイル名から名前の候補を作る', () => {
    expect(iconNameFromFileName('party-parrot.png')).toBe('party-parrot')
    expect(iconNameFromFileName('スタンプ.png')).toBeNull()
  })
})
