# 個人用記録サービス データモデル

## 方針

このサービスでは、以下の3つを独立した概念として扱う。

-   **Item**: TODO・タスクそのもの
-   **Section**:
    Itemについて、特定の日に行った作業や考えを記録する文章単位
-   **Diary**: カレンダーベースの1日1ページの日記

ItemとDiaryは役割が異なるため、同じ`type`を持つ汎用Itemには統合しない。
一方、Itemの本文は持たせず、日付付きのSectionを積み重ねてItemの記録を構成する。

------------------------------------------------------------------------

## ER構造

``` text
Item
  │
  │ 1:N
  ▼
Section

Diary
  │
  │ 1日1件
  ▼
Diary（dateを主キーとして管理）
```

日付を介して、DiaryとSectionを関連付ける。

``` text
Diary.date
    │
    └──── Section.date
              │
              └──── Section.item_id → Item
```

これにより、ある日のDiaryから「その日に作業したTODO」を自動的に取得できる。

------------------------------------------------------------------------

## Item

TODO・タスクを表す。

  カラム       型                     必須 説明
  ------------ -------------------- ------ ------------------------------------------------
  id           UUID / bigint           Yes Item ID
  title        text                    Yes TODOのタイトル
  status       enum                    Yes `inbox` / `backlog` / `in_progress` / `closed`
  due_at       timestamp nullable       No 期限。作業日とは別概念
  created_at   timestamp               Yes 作成日時
  updated_at   timestamp               Yes 更新日時

### status

-   `inbox`: 未整理
-   `backlog`: 着手可能
-   `in_progress`: 対応中
-   `closed`: 完了

### 日付について

Item自身には「作業日」を持たせない。

-   `due_at` = いつまでに対応するか
-   `Section.date` = いつこのItemについて作業・記録したか

と明確に分離する。

------------------------------------------------------------------------

## Section

Itemについて、その日に行った作業・検討内容などを記録する文章単位。

  カラム       型                   必須 説明
  ------------ ------------------ ------ ------------------
  id           UUID / bigint         Yes Section ID
  item_id      UUID / bigint         Yes 所属するItem
  date         date                  Yes 作業・記録の日付
  body         text / rich text      Yes その日の作業メモ
  position     integer               Yes Item内での表示順
  created_at   timestamp             Yes 作成日時
  updated_at   timestamp             Yes 更新日時

### 例

``` text
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

1つのItemに複数のSectionを持たせられるため、1つのTODOが複数日にまたがっても表現できる。

------------------------------------------------------------------------

## Diary

カレンダーベースの1日1ページの日記。

  カラム       型                   必須 説明
  ------------ ------------------ ------ ------------------------------
  date         date                  Yes 日付。1日1件なので主キー候補
  body         text / rich text      Yes その日の本文
  created_at   timestamp             Yes 作成日時
  updated_at   timestamp             Yes 更新日時

### 制約

`date` は一意。

``` text
2026-08-18 → Diary 1件
2026-08-19 → Diary 1件
2026-08-20 → Diary 1件
```

DiaryはSectionに分割せず、1日分の文章を直接`body`として持つ。

------------------------------------------------------------------------

## Diaryから「今日やったTODO」を表示する

Diary自体とSectionを直接関連付ける必要はない。

例えば、

``` text
Diary
date = 2026-08-18
```

に対して、

``` text
Section
date = 2026-08-18
item_id = A
```

``` text
Section
date = 2026-08-18
item_id = B
```

が存在すれば、

``` text
2026-08-18の日記

今日は個人用アプリの設計を進めた。


── 今日やったTODO ──

・個人用アプリのDB設計
・TODO管理の見直し
```

のように自動表示できる。

------------------------------------------------------------------------

## 双方向のナビゲーション

### Diary → Item

Diaryの日付と同じ`Section.date`を持つSectionを検索し、`item_id`からItemを取得する。

``` text
Diary 2026-08-18
    ↓
Section.date = 2026-08-18
    ↓
Section.item_id
    ↓
Item
```

### Item → Diary

Itemに紐づくSectionの日付から、対応するDiaryを取得する。

``` text
Item
    ↓
Section
    ↓
Section.date
    ↓
Diary.date
```

これにより、1つのTODOが複数日にまたがって作業された場合、それぞれの日のDiaryから同じItemへリンクできる。

------------------------------------------------------------------------

## 検索

検索対象となる文章は2種類。

1.  `Diary.body`
2.  `Section.body`

Itemのタイトルも検索対象にする。

``` text
検索
├── Item.title
├── Section.body
└── Diary.body
```

ItemとDiaryは別概念のまま維持しつつ、検索UIでは横断して検索結果を表示する。

例:

``` text
「DB設計」

2026-08-18  日記
今日はDB設計について考えた。

2026-08-18  個人用アプリのDB設計
DB設計のテーブル構成を検討した。

2026-08-19  日記
昨日考えたDB設計を整理した。
```

------------------------------------------------------------------------

## 設計上の重要な考え方

### 1. Itemにbodyを持たせない

Itemは「TODOそのもの」として、タイトル・状態・期限などのメタデータを持つ。

文章による記録はSectionに集約する。

### 2. 作業日はSectionに持たせる

``` text
Item.due_at
  = 期限

Section.date
  = その日に行った作業・記録
```

この2つは別物として扱う。

### 3. Diaryは1日1ページ

Diaryはカレンダー上の日付と1対1に対応する。

### 4. DiaryとSectionは別概念

Diaryは「その日の全体的な記録」。

Sectionは「特定のTODOについて、その日に何をしたか」。

同じ日付を持ち得るが、役割は異なる。

### 5. 日記とTODOの関連は日付から導出する

DiaryとItemを直接紐付ける中間テーブルは基本的に不要。

`Diary.date = Section.date`を利用して、当日に活動したItemを取得する。

------------------------------------------------------------------------

## PostgreSQL想定のDDL例

``` sql
CREATE TYPE item_status AS ENUM (
  'inbox',
  'backlog',
  'in_progress',
  'closed'
);

CREATE TABLE items (
  id UUID PRIMARY KEY,
  title TEXT NOT NULL,
  status item_status NOT NULL DEFAULT 'inbox',
  due_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE sections (
  id UUID PRIMARY KEY,
  item_id UUID NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  body TEXT NOT NULL,
  position INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX sections_item_id_idx
  ON sections(item_id);

CREATE INDEX sections_date_idx
  ON sections(date);

CREATE TABLE diaries (
  date DATE PRIMARY KEY,
  body TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

## 将来的に検討できること

-   Sectionに時刻を持たせる（`started_at` / `created_at`など）
-   SectionをMarkdownではなくリッチテキスト/ブロック構造で保存する
-   検索用の全文検索インデックスを作り、DiaryとSectionを横断検索する
-   Diary上で、その日に作業したItemを自動表示する
-   Item上で、そのItemに関連するDiaryへのリンクを日付ごとに表示する

現時点では、**Item / Section /
Diaryを別々の概念として保ち、DiaryとSectionは日付で疎結合に関連付ける**構造を基本案とする。
