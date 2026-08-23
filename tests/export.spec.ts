import { describe, expect, it } from 'vitest'
import { buildExport, toText, type ExportRows } from '~~/server/utils/export'
import type { Diary, Icon, Item, Section, Tag } from '~~/server/db/schema'

/**
 * 全データの書き出し（docs/05-operations.md 5.3）。
 *
 * **DB のユーザーデータがすべて入っているか**を確かめる。欠けていることに
 * 気づけるのは持ち出そうとしたときなので、形の変更はここで押さえる。
 */

const NOW = new Date('2026-08-23T00:00:00.000Z')

function item(overrides: Partial<Item> = {}): Item {
  return {
    id: '00000000-0000-4000-8000-000000000001',
    title: '設計をまとめる',
    status: 'backlog',
    priority: null,
    url: null,
    dueAt: null,
    dueHasTime: false,
    recurrenceRule: null,
    recurrenceBasis: null,
    seriesId: null,
    completedAt: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  }
}

function section(overrides: Partial<Section> = {}): Section {
  return {
    id: '00000000-0000-4000-8000-000000000011',
    itemId: '00000000-0000-4000-8000-000000000001',
    date: '2026-08-22',
    body: 'やったこと',
    position: 0,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  }
}

function rows(overrides: Partial<ExportRows> = {}): ExportRows {
  return {
    items: [],
    sections: [],
    diaries: [],
    tags: [],
    icons: [],
    tagNames: new Map(),
    ...overrides,
  }
}

describe('buildExport', () => {
  it('タスクに作業記録とタグ名を添える', () => {
    const data = buildExport(
      rows({
        items: [item()],
        sections: [section()],
        tagNames: new Map([[item().id, ['仕事']]]),
      }),
      NOW,
    )

    expect(data.items).toHaveLength(1)
    expect(data.items[0]?.tags).toEqual(['仕事'])
    expect(data.items[0]?.sections.map((s) => s.body)).toEqual(['やったこと'])
    // 一覧カードに出す本文は最初に作られた記録（docs/02-data-model.md 2.4）
    expect(data.items[0]?.body).toBe('やったこと')
    expect(data.items[0]?.primarySectionId).toBe(section().id)
  })

  it('日記を日時ごと書き出す', () => {
    const diary: Diary = {
      date: '2026-08-22',
      body: '今日のこと',
      createdAt: NOW,
      updatedAt: NOW,
    }

    expect(buildExport(rows({ diaries: [diary] }), NOW).diaries).toEqual([
      {
        date: '2026-08-22',
        body: '今日のこと',
        createdAt: NOW.toISOString(),
        updatedAt: NOW.toISOString(),
      },
    ])
  })

  it('タグを色ごと書き出す（Item に付いていないタグも残す）', () => {
    const tag: Tag = {
      id: '00000000-0000-4000-8000-000000000021',
      name: '仕事',
      color: 'rtm-blue',
      createdAt: NOW,
    }

    expect(buildExport(rows({ tags: [tag] }), NOW).tags).toEqual([
      { id: tag.id, name: '仕事', color: 'rtm-blue', createdAt: NOW.toISOString() },
    ])
  })

  it('登録したアイコンを書き出す', () => {
    const icon: Icon = {
      id: '00000000-0000-4000-8000-000000000031',
      name: 'ok',
      path: '/images/abc.png',
      createdAt: NOW,
    }

    expect(buildExport(rows({ icons: [icon] }), NOW).icons).toEqual([
      { id: icon.id, name: 'ok', path: '/images/abc.png', createdAt: NOW.toISOString() },
    ])
  })
})

describe('toText', () => {
  it('タスクと日記を読める形で並べる', () => {
    const text = toText(
      buildExport(
        rows({
          items: [item({ title: '設計をまとめる' })],
          sections: [section({ body: '方針を決めた' })],
          diaries: [
            { date: '2026-08-22', body: '今日のこと', createdAt: NOW, updatedAt: NOW },
          ],
          tagNames: new Map([[item().id, ['仕事']]]),
        }),
        NOW,
      ),
    )

    expect(text).toContain('## 設計をまとめる')
    expect(text).toContain('#仕事')
    expect(text).toContain('方針を決めた')
    expect(text).toContain('## 2026/08/22(土)')
    expect(text).toContain('今日のこと')
  })

  it('アイコンの対応表を添える（本文の :name: が何か分かるように）', () => {
    const icon: Icon = {
      id: '00000000-0000-4000-8000-000000000031',
      name: 'ok',
      path: '/images/abc.png',
      createdAt: NOW,
    }

    expect(toText(buildExport(rows({ icons: [icon] }), NOW))).toContain(
      '- :ok: /images/abc.png',
    )
  })

  it('アイコンが無ければ、その節も出さない', () => {
    expect(toText(buildExport(rows(), NOW))).not.toContain('# アイコン')
  })
})
