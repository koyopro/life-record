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
import { TAG_NAME_MAX_LENGTH } from '../../shared/types/tag'

/**
 * データモデルの定義は docs/02-data-model.md を正とする。
 * このファイルはその実装であり、変更時は必ずドキュメント側も更新すること。
 */

export const itemStatus = pgEnum('item_status', ITEM_STATUSES)

/** TODO・タスクそのもの。本文は持たず、記録は Section 側に積み重ねる。 */
export const items = pgTable(
  'items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    title: text('title').notNull(),
    status: itemStatus('status').notNull().default('inbox'),
    /** 重要度。1(高) / 2(中) / 3(低)、NULL は重要度なし。Milestone 3 で使い始める。 */
    priority: smallint('priority'),
    /** 期限。作業日（Section.date）とは別概念。 */
    dueAt: timestamp('due_at', { withTimezone: true }),
    /**
     * 期限に時刻の指定があるか。
     * false のとき due_at は当日の 23:59 を指し、UI では日付のみを表示する。
     */
    dueHasTime: boolean('due_has_time').notNull().default(false),
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
export type ItemStatus = Item['status']
