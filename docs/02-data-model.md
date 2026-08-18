# 02. データモデル

> **このドキュメントはデータ構造に関する正とする。**
> 他ドキュメントの記述と矛盾する場合は、こちらを優先する。

## 2.1 方針

以下の3つを独立した概念として扱う。

- **Item** — TODO・タスクそのもの
- **Section** — Item について、特定の日に行った作業や考えを記録する文章単位
- **Diary** — カレンダーベースの1日1ページの日記

加えて、Item を分類するための **Tag** を持つ（[09-tags.md](09-tags.md)）。

Item と Diary は役割が異なるため、共通の汎用エンティティには統合しない。
一方、**Item 自体には本文を持たせず**、日付付きの Section を積み重ねて Item の記録を構成する。

## 2.2 ER構造

```text
Tag ──N:N── Item
              │
              │ 1:N
              ▼
            Section

Diary
  （date を主キーとして 1日1件）
```

Diary と Section は直接のリレーションを持たず、**日付を介して関連付ける**。

```text
Diary.date
    │
    └──── Section.date
              │
              └──── Section.item_id → Item
```

これにより、ある日の Diary から「その日に作業した TODO」を導出できる。

---

## 2.3 Item

TODO・タスクを表す。

| カラム | 型 | 必須 | 説明 |
|---|---|---|---|
| id | UUID | Yes | Item ID |
| title | text | Yes | TODOのタイトル |
| status | enum | Yes | `inbox` / `backlog` / `in_progress` / `closed` |
| priority | smallint | No | 重要度。1（高） / 2（中） / 3（低）。NULL は重要度なし |
| url | text | No | 関連する URL。1件だけ持つ |
| due_at | timestamptz | No | 期限。作業日とは別概念 |
| due_has_time | boolean | Yes | 期限に時刻の指定があるか。false なら日付のみ |
| recurrence_rule | text | No | 繰り返し規則（RRULE 形式）。NULL なら繰り返しなし |
| recurrence_basis | enum | No | `due`（every） / `completion`（after） |
| series_id | UUID | No | 同じ繰り返しから生まれた Item 群の識別子 |
| created_at | timestamptz | Yes | 作成日時 |
| updated_at | timestamptz | Yes | 更新日時 |

繰り返し関連の3カラムの詳細は [10-recurrence.md](10-recurrence.md) を参照。

### status

| status | 意味 |
|---|---|
| `inbox` | 未整理 |
| `backlog` | 着手可能 |
| `in_progress` | 対応中 |
| `closed` | 完了 |

`inbox` は「未整理の一時置き場」として扱う。運用上は、整理後に随時空にしていくことを想定する。

### due_at と due_has_time

時刻の指定がない期限は、`due_at` にその日の 23:59 を入れ、`due_has_time` を false にする。
表示は日付のみとし、期限切れの判定も日付単位で行う（[08-todo-management.md](08-todo-management.md) 8.5）。

### priority

Remember The Milk に倣い、**値が小さいほど重要度が高い**。

| 値 | 意味 |
|---|---|
| 1 | 高 |
| 2 | 中 |
| 3 | 低 |
| NULL | 重要度なし |

一覧の既定のソートは「重要度順 → 期限日順」とし、NULL は末尾に置く。
詳細は [08-todo-management.md](08-todo-management.md) を参照。

カラム自体は初期スキーマに含めた。実際に使い始めたのは Milestone 3。

### url

タスクに関連する URL を1つだけ持つ。本文にもリンクは書けるが、
**一覧から直接開きたいもの**は属性として分けて持つ
（一覧で `u` で変更、`Shift` + `u` で開く。[08-todo-management.md](08-todo-management.md) 8.4）。

`http://` `https://` のみを保存する。別タブで開く先なので、
`javascript:` などは保存の時点で弾く。

### type カラムについて

**Item に `type` カラムは持たせない。**

用途（TODO / メモ など）を型で分類する設計は、初期実装では不要と判断した。
すべての Item を同一の構造として扱い、必要性が実運用で確認された時点で改めて検討する。

### 日付について

Item 自身には「作業日」を持たせない。

- `Item.due_at` = いつまでに対応するか（期限）
- `Section.date` = いつこの Item について作業・記録したか（作業日）

この2つは明確に別概念として分離する。

---

## 2.4 Section

Item について、その日に行った作業・検討内容などを記録する文章単位。

| カラム | 型 | 必須 | 説明 |
|---|---|---|---|
| id | UUID | Yes | Section ID |
| item_id | UUID | Yes | 所属する Item |
| date | date | Yes | 作業・記録の日付 |
| body | text | Yes | その日の作業メモ |
| position | integer | Yes | Item 内での表示順 |
| created_at | timestamptz | Yes | 作成日時 |
| updated_at | timestamptz | Yes | 更新日時 |

### 例

```text
Item:
  個人用アプリのDB設計

Section:
  2026-08-18
  ItemとDiaryの関係を整理した。

  2026-08-19
  Sectionを文章単位として扱う方針に決めた。

  2026-08-20
  DB設計を確定した。
```

1つの Item に複数の Section を持たせられるため、1つのTODOが複数日にまたがっても表現できる。

### body の形式

**Scrapbox 記法のプレーンテキスト**として保存する（[11-scrapbox-notation.md](11-scrapbox-notation.md)）。
HTML やリッチテキスト JSON にはしない。行頭の空白は階層を表すため、正規化しない。

---

## 2.5 Tag / ItemTag

Item を横断的に分類するためのタグ。詳細は [09-tags.md](09-tags.md)。

### tags

| カラム | 型 | 必須 | 説明 |
|---|---|---|---|
| id | UUID | Yes | タグID |
| name | text | Yes | タグ名（小文字に正規化・一意） |
| created_at | timestamptz | Yes | 作成日時 |

### item_tags

| カラム | 型 | 必須 | 説明 |
|---|---|---|---|
| item_id | UUID | Yes | Item |
| tag_id | UUID | Yes | タグ |

主キーは `(item_id, tag_id)`。

`status` は「進行状態」、タグは「内容による分類」であり、役割が異なる。両者は併存する。

---

## 2.6 Diary

カレンダーベースの1日1ページの日記。

| カラム | 型 | 必須 | 説明 |
|---|---|---|---|
| date | date | Yes | 日付。主キー |
| body | text | Yes | その日の本文 |
| created_at | timestamptz | Yes | 作成日時 |
| updated_at | timestamptz | Yes | 更新日時 |

### 制約

`date` は一意。

```text
2026-08-18 → Diary 1件
2026-08-19 → Diary 1件
2026-08-20 → Diary 1件
```

Diary は Section に分割せず、1日分の文章を直接 `body` として持つ。

---

## 2.7 Diary と Item の相互ナビゲーション

Diary と Section を直接関連付ける中間テーブルは不要。同じ `date` を持つことを利用する。

### Diary → Item

Diary の日付と同じ `Section.date` を持つ Section を検索し、`item_id` から Item を取得する。

```text
Diary 2026-08-18
    ↓
Section.date = 2026-08-18
    ↓
Section.item_id
    ↓
Item
```

表示イメージ:

```text
2026-08-18の日記

今日は個人用アプリの設計を進めた。


── 今日やったTODO ──

・個人用アプリのDB設計
・TODO管理の見直し
```

### Item → Diary

Item に紐づく Section の日付から、対応する Diary を取得する。

```text
Item
    ↓
Section
    ↓
Section.date
    ↓
Diary.date
```

1つのTODOが複数日にまたがって作業された場合、それぞれの日の Diary から同じ Item へリンクできる。

---

## 2.8 検索対象

検索対象となる文章は2種類。加えて Item のタイトルも対象とする。

```text
検索
├── Item.title
├── Section.body
└── Diary.body
```

Item と Diary は別概念のまま維持しつつ、検索UIでは横断して結果を表示する。

例:

```text
「DB設計」

2026-08-18  日記
今日はDB設計について考えた。

2026-08-18  個人用アプリのDB設計
DB設計のテーブル構成を検討した。

2026-08-19  日記
昨日考えたDB設計を整理した。
```

---

## 2.9 設計上の重要な考え方

### 1. Item に body を持たせない

Item は「TODOそのもの」として、タイトル・状態・期限などのメタデータのみを持つ。
文章による記録は Section に集約する。

### 2. 作業日は Section に持たせる

```text
Item.due_at   = 期限
Section.date  = その日に行った作業・記録
```

この2つは別物として扱う。

### 3. Diary は1日1ページ

Diary はカレンダー上の日付と1対1に対応する。

### 4. Diary と Section は別概念

- Diary — 「その日の全体的な記録」
- Section — 「特定のTODOについて、その日に何をしたか」

同じ日付を持ち得るが、役割は異なる。

### 5. 日記とTODOの関連は日付から導出する

Diary と Item を直接紐付ける中間テーブルは基本的に不要。
`Diary.date = Section.date` を利用して、当日に活動した Item を取得する。

---

## 2.10 DDL（PostgreSQL / Neon 想定）

最終的な全体像を示す。実際のマイグレーションは `drizzle/` にマイルストーンごとに
分かれて入っており、スキーマ定義は `server/db/schema.ts` にある。

```sql
CREATE TYPE item_status AS ENUM (
  'inbox',
  'backlog',
  'in_progress',
  'closed'
);

CREATE TYPE recurrence_basis AS ENUM ('due', 'completion');

CREATE TABLE items (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title            TEXT NOT NULL,
  status           item_status NOT NULL DEFAULT 'inbox',
  priority         SMALLINT CHECK (priority BETWEEN 1 AND 3),
  url              TEXT,
  due_at           TIMESTAMPTZ,
  due_has_time     BOOLEAN NOT NULL DEFAULT false,
  recurrence_rule  TEXT,
  recurrence_basis recurrence_basis,
  series_id        UUID,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- ルールがあるなら basis も必ずある
  CONSTRAINT items_recurrence_complete CHECK (
    (recurrence_rule IS NULL AND recurrence_basis IS NULL)
    OR (recurrence_rule IS NOT NULL AND recurrence_basis IS NOT NULL)
  )
);

CREATE INDEX items_status_idx
  ON items(status);

-- 既定のソート（重要度順 → 期限日順）に対応
CREATE INDEX items_priority_due_idx
  ON items (priority ASC NULLS LAST, due_at ASC NULLS LAST);

-- 系列の過去オカレンスを辿る経路
CREATE INDEX items_series_id_idx
  ON items (series_id);

CREATE TABLE tags (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name       TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT tags_name_unique UNIQUE (name),
  CONSTRAINT tags_name_not_blank CHECK (length(btrim(name)) > 0),
  CONSTRAINT tags_name_length CHECK (length(name) <= 50)
);

CREATE TABLE item_tags (
  item_id UUID NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  tag_id  UUID NOT NULL REFERENCES tags(id)  ON DELETE CASCADE,
  PRIMARY KEY (item_id, tag_id)
);

-- タグから Item を引く経路（item_id が先頭の主キーでは効かない）
CREATE INDEX item_tags_tag_id_idx
  ON item_tags (tag_id);

CREATE TABLE sections (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id    UUID NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  date       DATE NOT NULL,
  body       TEXT NOT NULL,
  position   INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX sections_item_id_idx
  ON sections(item_id);

CREATE INDEX sections_date_idx
  ON sections(date);

CREATE TABLE diaries (
  date       DATE PRIMARY KEY,
  body       TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

補足:

- `gen_random_uuid()` は PostgreSQL 13 以降で標準利用できる（Neon は対応済み）。
- `updated_at` の自動更新はアプリケーション側で行うか、トリガーを設ける。方式は未確定。
- 個人利用前提のため、初期段階では `user_id` を持たせない（[07-open-questions.md](07-open-questions.md) 参照）。
- `series_id` に外部キー制約は付けない。系列の起点となった Item が削除されても、
  残りのオカレンスは履歴として残したいため（[10-recurrence.md](10-recurrence.md) 10.8）。

---

## 2.11 将来的に検討できること

- Section に時刻を持たせる（`started_at` など）
- Scrapbox 記法の対応範囲を広げる（テーブル・アイコンなど）
- 全文検索インデックスを作り、Diary と Section を横断検索する
- Diary 上で、その日に作業した Item を自動表示する
- Item 上で、そのItemに関連する Diary へのリンクを日付ごとに表示する
- タグの階層化・タググループ
- 画像メタデータ管理テーブルの導入 → [07-open-questions.md](07-open-questions.md)

現時点では、**Item / Section / Diary を別々の概念として保ち、Diary と Section は日付で疎結合に関連付ける**構造を基本案とする。
