import { describe, expect, it } from 'vitest'
import { unappliedEdits, withLocalEdits } from '~/utils/local-edits'

/**
 * タグ・スマートリストは IndexedDB を通さず、取り直した内容をそのまま出す。
 * 押したそばから見た目を変えたいので手元へ先に当てるが、**取りに行った後に
 * 直すと、その取り直しの応答が後から届いて直す前に戻る**
 * （docs/15-client-state.md 14.2 の 4）。
 *
 * そこで「この端末で直した分」を別に持ち、届いた内容より優先する。
 */
describe('この端末で直した分の重ね方', () => {
  interface Row {
    id: string
    name: string
    color: string | null
    due?: { operator: string; days: number } | null
  }

  const rows: Row[] = [
    { id: 'a', name: '仕事', color: null },
    { id: 'b', name: '家', color: 'blue' },
  ]

  it('直した項目だけを重ねる', () => {
    const merged = withLocalEdits(rows, { a: { color: 'red' } })

    expect(merged[0]).toEqual({ id: 'a', name: '仕事', color: 'red' })
    // 直していないものはそのまま
    expect(merged[1]).toBe(rows[1])
  })

  it('取りに行った後に直した分は、古い応答が届いても残る', () => {
    const edits = { a: { color: 'red' } }
    // 直す前の写しが後から届いた
    const merged = withLocalEdits(rows, edits)

    expect(merged[0]?.color).toBe('red')
    // まだ届いていないので、次に届いた分にも重ね続ける
    expect(unappliedEdits(rows, edits)).toEqual(edits)
  })

  it('届いた内容が追いついたら、その分は落とす', () => {
    const applied: Row[] = [{ id: 'a', name: '仕事', color: 'red' }, rows[1]!]

    expect(unappliedEdits(applied, { a: { color: 'red' } })).toEqual({})
  })

  it('入れ子（期限の条件）も見て、追いついたかを判断する', () => {
    const due = { operator: 'within', days: 3 }
    const edits = { a: { due } }

    expect(unappliedEdits([{ ...rows[0]!, due }], edits)).toEqual({})
    expect(
      unappliedEdits([{ ...rows[0]!, due: { operator: 'within', days: 7 } }], edits),
    ).toEqual(edits)
  })

  it('一覧から消えたものは落とす（重ねる相手が無い）', () => {
    expect(unappliedEdits([rows[1]!], { a: { color: 'red' } })).toEqual({})
  })

  it('直した分が無ければ、届いた一覧をそのまま返す', () => {
    expect(withLocalEdits(rows, {})).toBe(rows)
  })
})
