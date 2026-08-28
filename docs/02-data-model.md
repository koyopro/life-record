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
一方、**Item 自体には記録（本文）を持たせず**、日付付きの Section を積み重ねて
Item の記録を構成する。ただし日付を持たない覚え書き（`Item.note`、「メモ」）だけは
Item が直接持つ。記録ではなくタスクそのものの説明であり、日付を持たせると
日記に出てしまうため（Diary と Section は日付だけで結び付く。2.8）。

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

記録そのものではないが、**SmartList**（保存した絞り込み。
[08-todo-management.md](08-todo-management.md) 8.6）と **Setting**（画面の設定）も
同じデータベースに置く。SmartList は条件だけを持ち、どの Item が入るかは
出すときに選び直すので、Item との関連は持たない。Setting は
一覧の並び・グループ順のような「どう見せるか」を鍵と値で持つだけで、どの
エンティティとも関連を持たない。ブラウザを変えても見え方を保つために置いて
いる（DDL は 2.11、扱いは [15-client-state.md](15-client-state.md) 14.7）。

---

## 2.3 Item

TODO・タスクを表す。

| カラム | 型 | 必須 | 説明 |
|---|---|---|---|
| id | UUID | Yes | Item ID |
| title | text | Yes | TODOのタイトル |
| status | enum | Yes | `backlog` / `in_progress` / `closed` |
| priority | smallint | No | 重要度。1（高） / 2（中） / 3（低）。NULL は重要度なし |
| url | text | No | 関連する URL。1件だけ持つ |
| note | text | No | タスクについての覚え書き（メモ）。日付を持たない |
| due_at | timestamptz | No | 期限。作業日とは別概念 |
| due_has_time | boolean | Yes | 期限に時刻の指定があるか。false なら日付のみ |
| recurrence_rule | text | No | 繰り返し規則（RRULE 形式）。NULL なら繰り返しなし |
| recurrence_basis | enum | No | `due`（every） / `completion`（after） |
| series_id | UUID | No | 同じ繰り返しから生まれた Item 群の識別子 |
| completed_at | timestamptz | No | 完了にした日時。`status` が `closed` 以外なら NULL |
| created_at | timestamptz | Yes | 作成日時 |
| updated_at | timestamptz | Yes | 更新日時 |

繰り返し関連の3カラムの詳細は [10-recurrence.md](10-recurrence.md) を参照。

### status

| status | 表示 | 意味 |
|---|---|---|
| `backlog` | 未着手 | まだ手を付けていない |
| `in_progress` | 対応中 | 着手している |
| `closed` | 完了 | 終わった |

かつては未整理の一時置き場として `inbox` を分けていたが、`backlog` との差が
運用上あいまいで、どちらに置くか迷うだけだったため「未着手」に統合した
（値は `backlog` のまま。移行は `drizzle/0008_rich_silver_surfer.sql`）。

### completed_at

`status` が `closed` になった瞬間の日時を入れ、`closed` 以外へ戻したら NULL に戻す。
「今日」リストの完了タスクを**期限ではなく「今日完了したか」で絞り込む**ために使う
（[08-todo-management.md](08-todo-management.md)）。`updated_at` は他の項目を変えるだけでも
更新されるため、完了日時としては使えない。

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

### note（メモ）

そのタスクについての覚え書き。**日付を持たない**のが作業記録（Section）との違い。

| | メモ（`Item.note`） | 作業記録（`Section`） |
|---|---|---|
| 日付 | 持たない | 持つ（`date`） |
| 日記 | 出ない | その日の日記に出る（2.8） |
| 内容 | このタスクについての説明・手順・前提 | その日にやったこと |
| 繰り返し | 次回オカレンスへ引き継ぐ | 引き継がない（回ごとに独立） |

繰り返しタスクで「毎回参照する手順」を残したい、という用途のために置いている。
作業記録をそのまま引き継ぐ形にはしない。作業記録は必ず日付を持ち、日付を持つ
ものは日記に出るため、引き継ぐたびに**関係のない日の日記へ現れてしまう**
（[10-recurrence.md](10-recurrence.md) 10.5）。

引き継ぐのは**写し**で、系列で1つを共有するのではない。共有にすると、済んだ回を
開いたときに当時のメモではなく今のメモが見えてしまい、「次の回だけ手順を書き換える」
もできなくなる。各オカレンスが独立した行であるという方針とも揃う。

記法・長さの上限は作業記録と同じ（Scrapbox 記法、`BODY_MAX_LENGTH`）。
空にしたら NULL に戻す。

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
| position | integer | Yes | **同一日付内**での表示順 |
| pinned | boolean | Yes | 日記でのピン留め（既定 false） |
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

### position

**同一日付内での並び順**であり、日付をまたいだ通し番号ではない。

一覧は日付の古い順に並べる（[03-functional-spec.md](03-functional-spec.md) 3.1）。
日付をまたぐ順序は `date` が決めるため、position が担うのは
「同じ日に複数の記録を書いたときの並び」だけでよい。

そのため、

- 作成時は **同じ Item・同じ日付**の末尾に置く
- 並べ替えは同じ日付の記録どうしでのみ行う
- 日付を変えたら、移した先の日付の末尾へ移す

### pinned（日記でのピン留め）

日記の「この日にやったこと」で、その記録を先頭にまとめて出すための印
（[03-functional-spec.md](03-functional-spec.md) 3.3）。1日に何件でも立てられる。

日記側ではなく Section が持つ。Diary と Section は日付だけで結び付いており
（2.8）、日記の行そのものが無い日（本文を書いていない日）でも作業記録はあるため、
日記側に持たせると留め先が無くなる。

送るのは本文の保存とまったく同じ経路（`PUT /api/sections/:id`）で、`pinned` を
**省略したら今の値のまま**にする。この経路は打鍵のたびに呼ばれるので、
省略を false と読むと本文を書くだけでピンが外れる。

### 「本文」として扱う Section

Item は本文を持たないため、一覧カードの本文（`ItemDto.body`）には
**その Item で最初に作られた Section**（`created_at` が最も古いもの）を使う。

position で決めない。position は同一日付内の並び順なので、
並べ替えたり日付を直したりした途端に、本文が別の記録へ移ってしまう。

**詳細画面で既定で編集する枠は、これとは別**であることに注意する。
そちらは「その日の Section」で、日をまたげば別の枠になる
（[03-functional-spec.md](03-functional-spec.md) 3.2）。

```text
一覧カードの本文   … 最初に作られた Section（その Item が何の話かを示す）
詳細で書き足す枠   … 当日の Section（今日その Item に何をしたかを書く）
```

分けているのは、日をまたいで書き足すたびに一覧の抜粋が入れ替わると、
一覧が「そのタスクが何か」ではなく「最後に何をしたか」の一覧になってしまうため。

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

## 2.7 Icon

本文に `:name:` と書いて置ける、自分で登録したアイコン
（[11-scrapbox-notation.md](11-scrapbox-notation.md) 11.8）。

| カラム | 型 | 必須 | 説明 |
|---|---|---|---|
| id | UUID | Yes | アイコンID |
| name | text | Yes | 呼び名（小文字・英数字と `_` `-`・32文字まで・一意） |
| path | text | Yes | 画像の場所（`/images/<ID>.<拡張子>`） |
| created_at | timestamptz | Yes | 作成日時 |

画像の実体は本文中の画像と同じく S3 に置き、ここは**その場所と名前だけ**を
持つ。アイコンのための置き場は作らない。

本文はこの表を参照しない（`:name:` という文字列があるだけ）。したがって、
アイコンを消しても本文は壊れず、書いた `:name:` が文字として残る。

---

## 2.8 Diary と Item の相互ナビゲーション

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

## 2.9 検索対象

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

## 2.10 設計上の重要な考え方

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

## 2.11 DDL（PostgreSQL / Neon 想定）

最終的な全体像を示す。実際のマイグレーションは `drizzle/` にマイルストーンごとに
分かれて入っており、スキーマ定義は `server/db/schema.ts` にある。

```sql
CREATE TYPE item_status AS ENUM (
  'backlog',
  'in_progress',
  'closed'
);

CREATE TYPE recurrence_basis AS ENUM ('due', 'completion');

CREATE TABLE items (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title            TEXT NOT NULL,
  status           item_status NOT NULL DEFAULT 'backlog',
  priority         SMALLINT CHECK (priority BETWEEN 1 AND 3),
  url              TEXT,
  due_at           TIMESTAMPTZ,
  due_has_time     BOOLEAN NOT NULL DEFAULT false,
  recurrence_rule  TEXT,
  recurrence_basis recurrence_basis,
  series_id        UUID,
  completed_at     TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- ルールがあるなら basis も必ずある
  CONSTRAINT items_recurrence_complete CHECK (
    (recurrence_rule IS NULL AND recurrence_basis IS NULL)
    OR (recurrence_rule IS NOT NULL AND recurrence_basis IS NOT NULL)
  ),
  -- completed_at が入るのは closed のときだけ
  CONSTRAINT items_completed_at_only_when_closed CHECK (
    status = 'closed' OR completed_at IS NULL
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

CREATE TABLE icons (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name       TEXT NOT NULL,
  path       TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT icons_name_unique UNIQUE (name),
  CONSTRAINT icons_name_not_blank CHECK (length(btrim(name)) > 0),
  CONSTRAINT icons_name_length CHECK (length(name) <= 32)
);

CREATE TABLE diaries (
  date       DATE PRIMARY KEY,
  body       TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 保存した絞り込み（スマートリスト）。中身は持たず、条件だけを持つ
CREATE TABLE smart_lists (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name       TEXT NOT NULL,
  tag        TEXT,                              -- 絞り込むタグ名。NULL なら絞り込まない
  view       TEXT NOT NULL DEFAULT 'open',      -- open / completed / all
  group_by   TEXT NOT NULL DEFAULT 'none',
  sort       TEXT NOT NULL DEFAULT 'priorityDueDesc',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT smart_lists_name_not_blank CHECK (length(btrim(name)) > 0),
  CONSTRAINT smart_lists_name_length CHECK (length(name) <= 50)
);

-- 画面の設定（一覧の並び・グループ順）。値の意味はクライアントが決める
CREATE TABLE settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT settings_key_not_blank CHECK (length(btrim(key)) > 0),
  CONSTRAINT settings_key_length CHECK (length(key) <= 100),
  CONSTRAINT settings_value_length CHECK (length(value) <= 500)
);
```

補足:

- `gen_random_uuid()` は PostgreSQL 13 以降で標準利用できる（Neon は対応済み）。
- `updated_at` の自動更新はアプリケーション側で行うか、トリガーを設ける。方式は未確定。
- 個人利用前提のため、初期段階では `user_id` を持たせない（[07-open-questions.md](07-open-questions.md) 参照）。
- `series_id` に外部キー制約は付けない。系列の起点となった Item が削除されても、
  残りのオカレンスは履歴として残したいため（[10-recurrence.md](10-recurrence.md) 10.8）。

---

## 2.12 将来的に検討できること

- Section に時刻を持たせる（`started_at` など）
- Scrapbox 記法の対応範囲を広げる（テーブル・アイコンなど）
- 全文検索インデックスを作り、Diary と Section を横断検索する
- Diary 上で、その日に作業した Item を自動表示する
- Item 上で、そのItemに関連する Diary へのリンクを日付ごとに表示する
- タグの階層化・タググループ
- 画像メタデータ管理テーブルの導入 → [07-open-questions.md](07-open-questions.md)

現時点では、**Item / Section / Diary を別々の概念として保ち、Diary と Section は日付で疎結合に関連付ける**構造を基本案とする。
