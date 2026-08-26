import { describe, expect, it } from 'vitest'
import {
  normalizeSmartListName,
  toSmartListInput,
  SMART_LIST_NAME_MAX_LENGTH,
} from '~~/shared/types/smart-list'
import { withTagDefaults } from '~~/shared/utils/smart-add'

/**
 * スマートリスト（docs/08-todo-management.md 8.6）。
 *
 * 入力の可否はサーバー（API）と画面のフォームの両方が同じ関数で決める。
 * 片方だけが緩いと、画面では作れるのに保存で 400 になる。
 */
describe('toSmartListInput', () => {
  const base = {
    name: '仕事の残り',
    tag: '仕事',
    view: 'open',
    groupBy: 'priority',
    sort: 'due',
  }

  it('そのまま読める入力は、整えた内容を返す', () => {
    expect(toSmartListInput({ ...base, name: '  仕事の残り  ' })).toEqual({
      name: '仕事の残り',
      tag: '仕事',
      due: null,
      view: 'open',
      groupBy: 'priority',
      sort: 'due',
    })
  })

  it('タグは、空文字なら「絞り込まない」（null）にする', () => {
    expect(toSmartListInput({ ...base, tag: '   ' })?.tag).toBeNull()
    expect(toSmartListInput({ ...base, tag: undefined })?.tag).toBeNull()
  })

  it('名前が無い・長すぎるものは読まない', () => {
    expect(toSmartListInput({ ...base, name: '   ' })).toBeNull()
    expect(
      toSmartListInput({ ...base, name: 'あ'.repeat(SMART_LIST_NAME_MAX_LENGTH + 1) }),
    ).toBeNull()
  })

  it('表示方法・グループ順・並びは、知らない値なら読まない', () => {
    expect(toSmartListInput({ ...base, view: 'archived' })).toBeNull()
    expect(toSmartListInput({ ...base, groupBy: 'tag' })).toBeNull()
    // 無くしたソート軸（タイトル順）も、いまは使えない
    expect(toSmartListInput({ ...base, sort: 'title' })).toBeNull()
  })
})

describe('normalizeSmartListName', () => {
  it('前後の空白は落とす', () => {
    expect(normalizeSmartListName(' 買い物 ')).toBe('買い物')
  })

  it('空・長すぎるものは null', () => {
    expect(normalizeSmartListName('')).toBeNull()
    expect(normalizeSmartListName('あ'.repeat(SMART_LIST_NAME_MAX_LENGTH + 1))).toBeNull()
  })
})

/**
 * 絞り込んで見ている一覧からの追加（タスク一覧のタグ絞り込み・スマートリスト）。
 * 付けないと、追加した途端にその一覧から消える。
 */
describe('withTagDefaults', () => {
  it('見ているタグを足す', () => {
    expect(withTagDefaults('請求書を出す', '仕事')).toContain('#仕事')
  })

  it('絞り込んでいなければ、そのまま', () => {
    expect(withTagDefaults('請求書を出す', null)).toBe('請求書を出す')
    expect(withTagDefaults('請求書を出す', undefined)).toBe('請求書を出す')
  })

  it('すでに書かれているタグは重ねない', () => {
    const text = withTagDefaults('請求書を出す #仕事', '仕事')
    expect(text.match(/#仕事/g)).toHaveLength(1)
  })

  it('書いた期限は消さない（書き方は日付に揃う）', () => {
    // 期限を書いていなければ「なし」を既定にするが、書いてあれば残す
    expect(withTagDefaults('請求書を出す ^明日', '仕事')).toMatch(/\^\d{4}\/\d{2}\/\d{2}/)
  })

  it('期限を書いていなければ、既定の「今日」ではなく「なし」にする', () => {
    // タグで見ている一覧からの追加は、今日やることとは限らない
    expect(withTagDefaults('請求書を出す', '仕事')).not.toMatch(/\^\d{4}\/\d{2}\/\d{2}/)
  })
})

describe('toSmartListInput（期限の条件）', () => {
  const base = {
    name: '今週中',
    tag: null,
    view: 'open',
    groupBy: 'none',
    sort: 'due',
  }

  it('渡さなければ「絞り込まない」（null）', () => {
    expect(toSmartListInput(base)?.due).toBeNull()
    expect(toSmartListInput({ ...base, due: null })?.due).toBeNull()
  })

  it('向きと式がそろっていれば、そのまま読む', () => {
    expect(
      toSmartListInput({ ...base, due: { operator: 'within', value: ' 金曜 ' } })?.due,
    ).toEqual({ operator: 'within', value: '金曜' })
  })

  it('日付を要らない向き（期限なし・期限あり）は式を持たない', () => {
    expect(
      toSmartListInput({ ...base, due: { operator: 'unset', value: '今日' } })?.due,
    ).toEqual({ operator: 'unset', value: '' })
  })

  /*
   * 式が空のまま保存できてしまうと、開いたときに何も当てはまらない
   * リストになる。作れてしまうより、作らせないほうがよい。
   */
  it('式が要る向きなのに空なら、入力ごと断る', () => {
    expect(toSmartListInput({ ...base, due: { operator: 'within', value: '  ' } })).toBeNull()
    expect(toSmartListInput({ ...base, due: { operator: 'on' } })).toBeNull()
  })

  it('知らない向きは読まない', () => {
    expect(toSmartListInput({ ...base, due: { operator: 'soon', value: '今日' } })).toBeNull()
  })
})
