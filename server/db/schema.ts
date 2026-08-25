import {
  boolean,
  check,
  date,
  index,
  integer,
  pgEnum,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core'
import { relations, sql } from 'drizzle-orm'
// drizzle-kit は Nuxt のエイリアスを解決しないため相対パスで参照する
import { ITEM_STATUSES } from '../../shared/types/item'
import { TAG_COLORS, TAG_NAME_MAX_LENGTH } from '../../shared/types/tag'
import { RECURRENCE_BASES } from '../../shared/types/recurrence'
import { ICON_NAME_MAX_LENGTH } from '../../shared/types/icon'
import {
  SETTING_KEY_MAX_LENGTH,
  SETTING_VALUE_MAX_LENGTH,
} from '../../shared/types/setting'
import { SMART_LIST_NAME_MAX_LENGTH } from '../../shared/types/smart-list'

/**
 * データモデルの定義は docs/02-data-model.md を正とする。
 * このファイルはその実装であり、変更時は必ずドキュメント側も更新すること。
 */

export const itemStatus = pgEnum('item_status', ITEM_STATUSES)

export const recurrenceBasis = pgEnum('recurrence_basis', RECURRENCE_BASES)

export const tagColor = pgEnum('tag_color', TAG_COLORS)

/** TODO・タスクそのもの。本文は持たず、記録は Section 側に積み重ねる。 */
export const items = pgTable(
  'items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    title: text('title').notNull(),
    status: itemStatus('status').notNull().default('backlog'),
    /** 重要度。1(高) / 2(中) / 3(低)、NULL は重要度なし。Milestone 3 で使い始める。 */
    priority: smallint('priority'),
    /**
     * 関連する URL を1つだけ持つ。
     * 本文にも書けるが、一覧から直接開きたいものは分けて持つ。
     */
    url: text('url'),
    /** 期限。作業日（Section.date）とは別概念。 */
    dueAt: timestamp('due_at', { withTimezone: true }),
    /**
     * 期限に時刻の指定があるか。
     * false のとき due_at は当日の 23:59 を指し、UI では日付のみを表示する。
     */
    dueHasTime: boolean('due_has_time').notNull().default(false),
    /**
     * 繰り返し規則（RFC 5545 の RRULE）。NULL なら繰り返しなし。
     * 詳細は docs/10-recurrence.md。
     */
    recurrenceRule: text('recurrence_rule'),
    /** `due`（毎〜: 期限起点） / `completion`（〜後: 完了日起点）。 */
    recurrenceBasis: recurrenceBasis('recurrence_basis'),
    /** 同じ繰り返しから生まれた Item 群の識別子。起点 Item の id を入れる。 */
    seriesId: uuid('series_id'),
    /**
     * 完了にした日時。status が closed になった瞬間だけ入れ、
     * 再オープンで null に戻す。「今日」リストの完了タスクを
     * 「今日完了したもの」だけに絞るために使う。
     */
    completedAt: timestamp('completed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index('items_status_idx').on(t.status),
    // 既定のソート（重要度順 → 期限日順）に対応する
    index('items_priority_due_idx').on(
      sql`${t.priority} ASC NULLS LAST`,
      sql`${t.dueAt} ASC NULLS LAST`,
    ),
    check('items_priority_range', sql`${t.priority} BETWEEN 1 AND 3`),
    // 系列の過去オカレンスを辿る経路。
    // series_id に外部キーは張らない。起点 Item が削除されても、
    // 残りのオカレンスは履歴として残したいため（docs/10-recurrence.md 10.8）。
    index('items_series_id_idx').on(t.seriesId),
    // ルールがあるなら basis も必ずある
    check(
      'items_recurrence_complete',
      sql`(${t.recurrenceRule} IS NULL AND ${t.recurrenceBasis} IS NULL)
          OR (${t.recurrenceRule} IS NOT NULL AND ${t.recurrenceBasis} IS NOT NULL)`,
    ),
    // completed_at が入るのは closed のときだけ
    check(
      'items_completed_at_only_when_closed',
      sql`${t.status} = 'closed' OR ${t.completedAt} IS NULL`,
    ),
  ],
)

/** ある Item について、その日に行った作業・検討内容の記録。 */
export const sections = pgTable(
  'sections',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    itemId: uuid('item_id')
      .notNull()
      .references(() => items.id, { onDelete: 'cascade' }),
    /** 作業・記録の日付。Diary とはこの日付で疎結合に対応する。 */
    date: date('date').notNull(),
    body: text('body').notNull(),
    /** Item 内での表示順。 */
    position: integer('position').notNull().default(0),
    /**
     * 日記でのピン留め（docs/03-functional-spec.md 3.3）。
     *
     * 立てると、その日の「この日にやったこと」の先頭にまとめて出る。
     * 1日に何件でも立てられる。
     */
    pinned: boolean('pinned').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index('sections_item_id_idx').on(t.itemId),
    index('sections_date_idx').on(t.date),
  ],
)

/** Item を横断的に分類するタグ。名前は正規化済み（docs/09-tags.md）。 */
export const tags = pgTable(
  'tags',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull(),
    /** 表示色。未設定は NULL（表示側は既定の色で出す）。 */
    color: tagColor('color'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    unique('tags_name_unique').on(t.name),
    check('tags_name_not_blank', sql`length(btrim(${t.name})) > 0`),
    check('tags_name_length', sql`length(${t.name}) <= ${sql.raw(String(TAG_NAME_MAX_LENGTH))}`),
  ],
)

export const itemTags = pgTable(
  'item_tags',
  {
    itemId: uuid('item_id')
      .notNull()
      .references(() => items.id, { onDelete: 'cascade' }),
    tagId: uuid('tag_id')
      .notNull()
      .references(() => tags.id, { onDelete: 'cascade' }),
  },
  (t) => [
    primaryKey({ columns: [t.itemId, t.tagId] }),
    // タグから Item を引く経路（item_id が先頭の主キーでは効かない）
    index('item_tags_tag_id_idx').on(t.tagId),
  ],
)

/**
 * 自分で登録するアイコン（docs/11-scrapbox-notation.md 11.8）。
 *
 * 画像そのものは本文中の画像と同じく S3 に置き、ここにはその場所
 * （`/images/<ID>.<拡張子>`）と呼び名だけを持つ。
 */
export const icons = pgTable(
  'icons',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull(),
    path: text('path').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    unique('icons_name_unique').on(t.name),
    check('icons_name_not_blank', sql`length(btrim(${t.name})) > 0`),
    check(
      'icons_name_length',
      sql`length(${t.name}) <= ${sql.raw(String(ICON_NAME_MAX_LENGTH))}`,
    ),
  ],
)

/**
 * スマートリスト（docs/08-todo-management.md 8.6）。
 *
 * よく見る絞り込みに名前を付けて残しておくもの（RTM の Smart List）。
 * 条件だけを持ち、どの Item が入るかは出すときに選び直すので、Item との
 * 関連は持たない。
 */
export const smartLists = pgTable(
  'smart_lists',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull(),
    /** 絞り込むタグ名。NULL なら絞り込まない。タグの id ではなく名前で持つ */
    tag: text('tag'),
    /** 表示方法（`open` / `completed` / `all`）。 */
    view: text('view').notNull().default('open'),
    /** グループ順・並び。名前はクライアントの GroupKey / SortKey と同じ */
    groupBy: text('group_by').notNull().default('none'),
    sort: text('sort').notNull().default('priorityDueDesc'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    check('smart_lists_name_not_blank', sql`length(btrim(${t.name})) > 0`),
    check(
      'smart_lists_name_length',
      sql`length(${t.name}) <= ${sql.raw(String(SMART_LIST_NAME_MAX_LENGTH))}`,
    ),
  ],
)

/**
 * 画面の設定（docs/15-client-state.md 14.7）。
 *
 * 一覧の並び・グループ順のように「どう見せるか」だけを持つ。ブラウザごとの
 * localStorage に閉じていると、端末を変えるたびに見え方が変わってしまうため、
 * 正本はここに置く。中身の意味はクライアントが決めるので、鍵と値の文字列だけを
 * 預かる（項目が増えてもテーブルは変えない）。
 */
export const settings = pgTable(
  'settings',
  {
    key: text('key').primaryKey(),
    value: text('value').notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    check('settings_key_not_blank', sql`length(btrim(${t.key})) > 0`),
    check(
      'settings_key_length',
      sql`length(${t.key}) <= ${sql.raw(String(SETTING_KEY_MAX_LENGTH))}`,
    ),
    check(
      'settings_value_length',
      sql`length(${t.value}) <= ${sql.raw(String(SETTING_VALUE_MAX_LENGTH))}`,
    ),
  ],
)

/** カレンダーベースの1日1ページの日記。date が主キー。 */
export const diaries = pgTable('diaries', {
  date: date('date').primaryKey(),
  body: text('body').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
})

export const itemsRelations = relations(items, ({ many }) => ({
  sections: many(sections),
  itemTags: many(itemTags),
}))

export const sectionsRelations = relations(sections, ({ one }) => ({
  item: one(items, {
    fields: [sections.itemId],
    references: [items.id],
  }),
}))

export const tagsRelations = relations(tags, ({ many }) => ({
  itemTags: many(itemTags),
}))

export const itemTagsRelations = relations(itemTags, ({ one }) => ({
  item: one(items, {
    fields: [itemTags.itemId],
    references: [items.id],
  }),
  tag: one(tags, {
    fields: [itemTags.tagId],
    references: [tags.id],
  }),
}))

export type Item = typeof items.$inferSelect
export type NewItem = typeof items.$inferInsert
export type Section = typeof sections.$inferSelect
export type NewSection = typeof sections.$inferInsert
export type Diary = typeof diaries.$inferSelect
export type NewDiary = typeof diaries.$inferInsert
export type Tag = typeof tags.$inferSelect
export type NewTag = typeof tags.$inferInsert
export type Icon = typeof icons.$inferSelect
export type NewIcon = typeof icons.$inferInsert
export type SmartList = typeof smartLists.$inferSelect
export type NewSmartList = typeof smartLists.$inferInsert
export type ItemStatus = Item['status']
