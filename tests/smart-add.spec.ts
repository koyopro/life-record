import { describe, expect, it } from 'vitest'
import { parseRecurrence } from '~~/shared/utils/recurrence'
import {
  composeSmartAddInput,
  mergeSmartAddOverrides,
  parseSmartAdd,
} from '~~/shared/utils/smart-add'

/**
 * ボタンで選んだ内容の書き戻し（docs/08-todo-management.md 8.5）。
 *
 * 書き戻したテキストは、そのままサーバーへ送られて解釈し直される。
 * 選んだとおりに解釈されることが要なので、往復で確かめる。
 */
describe('composeSmartAddInput', () => {
  const now = new Date(2026, 7, 18, 10, 0)

  it('何も選んでいなければ書き換えない', () => {
    const input = '請求書を出す ^明日 !1'
    expect(composeSmartAddInput(input, {}, now)).toBe(input)
  })

  it('選んだ期限が、そのままの日付として解釈される', () => {
    const composed = composeSmartAddInput(
      '牛乳を買う',
      { due: { date: new Date(2026, 8, 3, 23, 59), hasTime: false } },
      now,
    )
    const parsed = parseSmartAdd(composed, now)

    expect(parsed.title).toBe('牛乳を買う')
    expect(parsed.dueHasTime).toBe(false)
    expect(parsed.dueAt?.getFullYear()).toBe(2026)
    expect(parsed.dueAt?.getMonth()).toBe(8)
    expect(parsed.dueAt?.getDate()).toBe(3)
  })

  it('時刻まで選んだ期限は、時刻ごと解釈される', () => {
    const composed = composeSmartAddInput(
      '打ち合わせ',
      { due: { date: new Date(2026, 8, 3, 15, 30), hasTime: true } },
      now,
    )
    const parsed = parseSmartAdd(composed, now)

    expect(parsed.dueHasTime).toBe(true)
    expect(parsed.dueAt?.getHours()).toBe(15)
    expect(parsed.dueAt?.getMinutes()).toBe(30)
  })

  it('重要度・タグ・繰り返しをまとめて書き戻せる', () => {
    const composed = composeSmartAddInput(
      'ゴミを出す',
      {
        priority: 1,
        tags: ['家事', '朝'],
        recurrence: parseRecurrence('毎週月曜'),
      },
      now,
    )
    const parsed = parseSmartAdd(composed, now)

    expect(parsed.title).toBe('ゴミを出す')
    expect(parsed.priority).toBe(1)
    expect(parsed.tags).toEqual(['家事', '朝'])
    expect(parsed.recurrence).toEqual(parseRecurrence('毎週月曜'))
    expect(parsed.warnings).toEqual([])
  })

  it('テキストに書いた記法は、ボタンで選んだ内容に置き換わる', () => {
    const composed = composeSmartAddInput(
      '請求書を出す ^明日 !3 #仕事',
      { priority: 1, tags: ['経理'] },
      now,
    )
    const parsed = parseSmartAdd(composed, now)

    // 選んでいない期限はテキストのまま（明日 = 8/19）
    expect(parsed.dueAt?.getDate()).toBe(19)
    expect(parsed.priority).toBe(1)
    expect(parsed.tags).toEqual(['経理'])
    expect(parsed.title).toBe('請求書を出す')
  })

  it('「指定しない」を選ぶと、テキストに書いた記法を打ち消す', () => {
    const composed = composeSmartAddInput(
      '請求書を出す ^明日 !1',
      { due: null, priority: null },
      now,
    )
    const parsed = parseSmartAdd(composed, now)

    expect(parsed.title).toBe('請求書を出す')
    expect(parsed.dueAt).toBeNull()
    expect(parsed.priority).toBeNull()
  })

  it('2行目以降（本文）と URL は書き戻しても残る', () => {
    const composed = composeSmartAddInput(
      '資料を読む https://example.com/doc\n気になった点をメモ\n2段落目',
      { priority: 2 },
      now,
    )
    const [titleLine, ...body] = composed.split('\n')
    const parsed = parseSmartAdd(titleLine!, now)

    expect(parsed.title).toBe('資料を読む')
    expect(parsed.url).toBe('https://example.com/doc')
    expect(parsed.priority).toBe(2)
    expect(body.join('\n')).toBe('気になった点をメモ\n2段落目')
  })

  it('空の入力は書き換えない', () => {
    expect(composeSmartAddInput('   ', { priority: 1 }, now)).toBe('   ')
  })
})

/**
 * `^なし` / `^x`（期限を明示的に「なし」にする）。
 *
 * 期限を書かなかった場合は既定で今日になる（8.5）ため、
 * それを打ち消す唯一の書き方として区別できる必要がある。
 */
describe('^なし / ^x（期限の明示的な打ち消し）', () => {
  const now = new Date(2026, 7, 18, 10, 0)

  it('^なし は期限なし・dueCleared を立てて解釈する', () => {
    const parsed = parseSmartAdd('観葉植物を見に行く ^なし', now)
    expect(parsed.title).toBe('観葉植物を見に行く')
    expect(parsed.dueAt).toBeNull()
    expect(parsed.dueCleared).toBe(true)
  })

  it('^x / ^X も同じ扱いにする（大文字小文字を問わない）', () => {
    expect(parseSmartAdd('牛乳を買う ^x', now).dueCleared).toBe(true)
    expect(parseSmartAdd('牛乳を買う ^X', now).dueCleared).toBe(true)
  })

  it('何も書かなければ dueCleared は立たない（既定の今日に任せる）', () => {
    expect(parseSmartAdd('牛乳を買う', now).dueCleared).toBe(false)
  })

  it('実際の日付を書いたときは dueCleared にならない', () => {
    expect(parseSmartAdd('牛乳を買う ^明日', now).dueCleared).toBe(false)
  })

  it('「期限を外す」ボタン（due: null）は、書き戻しても ^なし として残る', () => {
    const composed = composeSmartAddInput('請求書を出す ^明日 !1', { due: null }, now)
    const parsed = parseSmartAdd(composed, now)

    expect(parsed.dueAt).toBeNull()
    expect(parsed.dueCleared).toBe(true)
    // 他の記法（重要度）は影響を受けない
    expect(parsed.priority).toBe(1)
  })
})

/** 入力欄の表示（ボタンの状態とプレビュー）が見る、重ねた結果。 */
describe('mergeSmartAddOverrides', () => {
  it('まだ何も書いていなくても、選んだ内容を返す', () => {
    const values = mergeSmartAddOverrides(null, { priority: 2, tags: ['家事'] })

    expect(values.priority).toBe(2)
    expect(values.tags).toEqual(['家事'])
    expect(values.due).toBeNull()
  })

  it('選んでいない項目はテキストの記法に従う', () => {
    const parsed = parseSmartAdd('請求書を出す !1 #仕事', new Date(2026, 7, 18))
    const values = mergeSmartAddOverrides(parsed, { priority: null })

    expect(values.priority).toBeNull()
    expect(values.tags).toEqual(['仕事'])
  })

  it('テキストの ^なし を dueCleared として伝える', () => {
    const parsed = parseSmartAdd('観葉植物を見に行く ^なし', new Date(2026, 7, 18))
    const values = mergeSmartAddOverrides(parsed, {})

    expect(values.due).toBeNull()
    expect(values.dueCleared).toBe(true)
  })

  it('「期限を外す」ボタン（due: null）も dueCleared にする', () => {
    const values = mergeSmartAddOverrides(null, { due: null })
    expect(values.dueCleared).toBe(true)
  })

  it('何も指定していなければ dueCleared にならない', () => {
    const values = mergeSmartAddOverrides(null, {})
    expect(values.dueCleared).toBe(false)
  })
})
