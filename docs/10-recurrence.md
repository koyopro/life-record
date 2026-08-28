# 10. 繰り返しタスク

Remember The Milk と同等の繰り返し機能。

---

## 10.1 RTM の繰り返しの考え方

RTM の繰り返しには、性質の異なる2種類がある。**この区別が繰り返し機能の核心。**

| 種別 | 起点 | 例 | 挙動 |
|---|---|---|---|
| **every**（毎〜） | 期限日 | `every week` | 完了が遅れても、次回期限は元の期限から1週間後 |
| **after**（〜後） | 完了日 | `after 1 week` | 完了した日から1週間後が次回期限 |

### 使い分け

```text
every month  ゴミ出し・家賃の支払いなど、カレンダー上の日付が決まっているもの
             → 3日遅れて完了しても、次回は元どおりの日付

after 3 days 掃除・水やりなど、前回やってからの間隔が意味を持つもの
             → 5日空いてから完了したら、そこから3日後
```

この2つを取り違えると実用にならないため、UI でも明確に区別して表示する。

---

## 10.2 オカレンスの表現方針

**完了時に、次回分を新しい Item として生成する。**（RTM と同じ方式）

1つの Item を使い回して `due_at` だけ進める方式は採らない。理由は以下。

- 各回について、その回に何をしたかの Section（作業記録）を独立して残せる
- 「先週の分は完了したが今週の分はまだ」という状態を表現できる
- 過去の完了履歴が残る

### 系列の識別

同じ繰り返しから生まれた Item 群を `series_id` で束ねる。

```text
series_id = A
  ├── Item A   期限 8/18  closed    ← 最初の Item。id = series_id = A
  ├── Item B   期限 8/25  closed
  └── Item C   期限 9/1   in_progress  ← 現在の未完了オカレンス
```

- 最初の Item の `id` をそのまま `series_id` に入れる
- 系列単位で「この繰り返しをやめる」「全オカレンスを見る」といった操作ができる

### 未完了オカレンスは常に1つ

次回分を生成するのは**完了した瞬間**。先の分をまとめて作らない。
未完了のオカレンスが一覧に積み上がると、RTM の使い勝手から外れるため。

---

## 10.3 データモデル

`items` に3カラムを追加する。

| カラム | 型 | 必須 | 説明 |
|---|---|---|---|
| recurrence_rule | text | No | 繰り返し規則（RRULE 形式）。NULL なら繰り返しなし |
| recurrence_basis | enum | No | `due`（every） / `completion`（after）。ルールがあるとき必須 |
| series_id | UUID | No | 同じ繰り返しから生まれた Item 群の識別子 |

### 規則の表現

**RFC 5545 の RRULE 形式**で保存する。

```text
every day            → FREQ=DAILY
every 2 weeks        → FREQ=WEEKLY;INTERVAL=2
every monday         → FREQ=WEEKLY;BYDAY=MO
every month on the 1 → FREQ=MONTHLY;BYMONTHDAY=1
every year           → FREQ=YEARLY
```

独自形式ではなく標準形式を使う理由は、**他のカレンダー・タスク管理ツールへ移行しやすいこと**。
長期利用とデータの持ち出しやすさを重視する方針（[05-operations.md](05-operations.md)）に沿う。

`after`（完了日起点）は RRULE では表現できない概念なので、`recurrence_basis` で別途持つ。
`after 3 days` は `FREQ=DAILY;INTERVAL=3` + `basis = completion` として保存する。

### 終了条件

RRULE の `COUNT` / `UNTIL` をそのまま使う。

```text
every week for 10 times → FREQ=WEEKLY;COUNT=10
every day until 12/31   → FREQ=DAILY;UNTIL=20261231T000000Z
```

生成すべき次回が終了条件を超えた場合、次の Item を作らずに系列を終える。

#### COUNT は自前で数える

**`COUNT` の判定は rrule ライブラリに任せられない。**

各オカレンスは自分の期限を起点に次回を計算するため、`DTSTART` が毎回動く。
ライブラリに `COUNT` を渡すと、その動いた起点から数え直してしまい、
何回繰り返しても終わらない（実装時に実際にそうなった）。

そのため `COUNT` はライブラリに渡さず、**同じ `series_id` を持つ Item の件数**と
突き合わせて判定する。`UNTIL` は絶対日時なので起点が動いても影響を受けず、
そのままライブラリに任せてよい。

---

## 10.4 次回期限の計算

### basis = `due`（every）

現在の Item の `due_at` を起点に、RRULE の次の発生日を求める。

```text
期限 8/18 の「every week」を 8/22 に完了
  → 次回期限は 8/25（完了日ではなく、元の期限が起点）
```

**期限が設定されていない場合**は完了日時を起点にする（起点が他にないため）。

**次回期限が過去になる場合**は、未来になるまで進める。

```text
期限 5/1 の「every week」を 8/22 に完了
  → 5/8, 5/15, ... と進めて、8/22 より後の最初の発生日（8/28）を採用する
```

長期間放置した繰り返しタスクが、過去日で大量に積み上がるのを防ぐため。

### basis = `completion`（after）

完了日時を起点に、RRULE の間隔を1回分だけ加算する。

```text
「after 3 days」を 8/22 に完了 → 次回期限は 8/25
```

過去日になることは原理的に起きない。

### 時刻の扱い

- 元の `due_at` が時刻を持つ場合は、その時刻を引き継ぐ
- 持たない場合は、期限日の終わり（23:59）として扱う
- タイムゾーンは Asia/Tokyo 固定（[08-todo-management.md](08-todo-management.md) 8.5）

---

## 10.5 引き継ぐもの / 引き継がないもの

次回オカレンスを生成する際、元の Item から引き継ぐ内容。

| 項目 | 引き継ぐ | 備考 |
|---|---|---|
| title | ○ | |
| priority | ○ | |
| url | ○ | 毎週見に行くページなど、回が変わっても行き先は同じことが多い |
| note（メモ） | ○ | 回をまたいで残したい手順・前提の置き場（[02-data-model.md](02-data-model.md) 2.3）。写しを渡すので、次の回で書き換えても済んだ回はそのまま |
| tags | ○ | [09-tags.md](09-tags.md) |
| recurrence_rule / basis | ○ | |
| series_id | ○ | |
| due_at | 計算 | 10.4 のとおり |
| status | × | 常に `backlog`（未着手）から始まる |
| Section（作業記録） | × | 回ごとに独立させる。これがオカレンスを分ける主目的 |

作業記録を引き継がないのは、**日付を持つものは日記に出る**ため
（Diary と Section は日付だけで結び付く）。引き継ぐと、関係のない日の日記に
過去の回の記録が現れてしまう。回をまたいで残したいことは、日付を持たない
メモ（`Item.note`）に書く。

新しいオカレンスの `status` は `backlog`（未着手）にする。

---

## 10.6 操作

### 繰り返しの設定

- Item 詳細から設定する
- SmartAdd の `*` でも指定できる（10.7）
- 種別（every / after）・間隔・終了条件を指定する
- 設定内容を自然文で確認表示する（例:「毎週月曜」「完了の3日後」）

### 繰り返しの変更

**変更は、以降のオカレンスにのみ効く。** 過去に生成済みの Item は書き換えない。
各オカレンスが独立した行であるため、自然にこの挙動になる。

### 繰り返しの停止

- 現在のオカレンスから `recurrence_rule` を外す → 完了しても次が作られない
- すでに完了した過去のオカレンスはそのまま残る

### 完了以外での終了

繰り返し中の Item を**削除**した場合、次回は生成しない。
完了ではないため、系列はそこで途切れる。

### 表示

- 繰り返し中の Item には、一覧でその旨を示すアイコンを表示する
- Item 詳細では、系列の過去オカレンス（完了済み）を辿れるようにする

---

## 10.7 SmartAdd の `*`

[08-todo-management.md](08-todo-management.md) 8.5 で予約としていた `*` を、繰り返しとして解釈する。

```text
入力:  ゴミを出す ^火曜 *every week !3
結果:  title            = "ゴミを出す"
       due_at           = 次の火曜
       priority         = 3
       recurrence_rule  = FREQ=WEEKLY
       recurrence_basis = due
```

### 受け付ける表現

RTM と同様に自然言語で書けるようにする。日本語・英語の両方に対応する。

| 入力 | RRULE | basis |
|---|---|---|
| `*every day` / `*毎日` | `FREQ=DAILY` | due |
| `*every week` / `*毎週` | `FREQ=WEEKLY` | due |
| `*every monday` / `*毎週月曜` | `FREQ=WEEKLY;BYDAY=MO` | due |
| `*every 2 weeks` / `*2週間ごと` | `FREQ=WEEKLY;INTERVAL=2` | due |
| `*every month` / `*毎月` | `FREQ=MONTHLY` | due |
| `*毎月15日` | `FREQ=MONTHLY;BYMONTHDAY=15` | due |
| `*毎月の最後の平日` / `*every month on the last weekday` | `FREQ=MONTHLY;BYDAY=MO,TU,WE,TH,FR;BYSETPOS=-1` | due |
| `*毎月の第2月曜` / `*every month on the 2nd monday` | `FREQ=MONTHLY;BYDAY=2MO` | due |
| `*every year` / `*毎年` | `FREQ=YEARLY` | due |
| `*after 3 days` / `*完了の3日後` / `*3日後` | `FREQ=DAILY;INTERVAL=3` | completion |
| `*after 1 week` / `*完了の1週間後` / `*1週間後` | `FREQ=WEEKLY` | completion |

- `完了の` は省略できる（`3日後` だけで `完了の3日後` と同じ）。「後」は
  due（毎〜）側では使わない語なので、省略しても曖昧にならない

#### 月の中の並びで決まる指定

「毎月の最後の平日」のように、**どの曜日かではなく、その月の何番目か**で日が
決まる指定を受け付ける（RTM の「オン: 最後の・平日」に当たる）。月末が土日なら
その前の金曜になる、という月ごとに日付が変わる繰り返しは、`BYMONTHDAY` では
表せない。

| 書き方 | 意味 |
|---|---|
| `最後の` / `最終` / `last` | その月の最後（`-1`） |
| `最初の` / `first` | その月の最初（`1`） |
| `第2` / `2番目の` / `2nd` | 2番目（`2`）。月に無い並び（6以上）は受け付けない |
| `最後から2番目の` | 後ろから数える（`-2`） |
| `平日` / `weekday` | 月〜金 |
| `週末` / `weekend` | 土日 |
| `月曜` / `monday` | その曜日 |

RRULE では2通りの書き方になる。曜日が1つなら `BYDAY` に序数を付け（`BYDAY=-1MO`）、
平日・週末のように**曜日の組**なら、その組の中の何番目かを `BYSETPOS` で表す
（`BYDAY=MO,TU,WE,TH,FR;BYSETPOS=-1`）。どちらも RFC 5545 の書き方なので、
RTM の書き出しをそのまま取り込める。

**表示（`describeRecurrence`）と解釈（`parseRecurrence`）は往復できること。**
設定ダイアログは、いまの設定を文にしてから入力欄へ入れる。読めない文を出すと、
開き直しただけで設定を失う（取り込んだ規則で実際にそうなっていた）。
- パースはサーバー側で行い、入力中のプレビューはクライアントでも同じロジックを動かす
- 解釈できなかった場合は、繰り返しを設定せず警告を出す（黙って無視しない）
- 実装候補: [rrule.js](https://github.com/jkbrzt/rrule)（RRULE の生成・次回発生日の計算・自然文表示に対応）。
  日本語表現から RRULE への変換は自前で実装する

### キーボードショートカット

[08-todo-management.md](08-todo-management.md) 8.4 の表に以下を追加する。

| キー | 操作 |
|---|---|
| `f` | 選択中のタスクのくり返し設定を変更 |

RTM の「くり返し設定を変更」に合わせて `f` を使う（`r` は名称変更）。

---

## 10.8 DDL

```sql
CREATE TYPE recurrence_basis AS ENUM ('due', 'completion');

ALTER TABLE items
  ADD COLUMN recurrence_rule  TEXT,
  ADD COLUMN recurrence_basis recurrence_basis,
  ADD COLUMN series_id        UUID;

-- ルールがあるなら basis も必ずある
ALTER TABLE items
  ADD CONSTRAINT items_recurrence_complete
  CHECK (
    (recurrence_rule IS NULL AND recurrence_basis IS NULL)
    OR (recurrence_rule IS NOT NULL AND recurrence_basis IS NOT NULL)
  );

-- 系列の過去オカレンスを辿る経路
CREATE INDEX items_series_id_idx
  ON items (series_id);
```

`series_id` に外部キー制約は付けない。系列の起点となった Item が削除されても、
残りのオカレンスは履歴として残したいため。

---

## 10.9 実装スコープ

[06-roadmap.md](06-roadmap.md) Milestone 5 として実装する。

- [x] `recurrence_rule` / `recurrence_basis` / `series_id` の追加（マイグレーション）
- [x] RRULE のパースと次回発生日の計算
- [x] 自然言語（日本語・英語）→ RRULE の変換
- [x] RRULE → 自然文の表示
- [x] 完了時に次回オカレンスを生成する処理
  - [x] basis = due（過去日になる場合は未来まで進める）
  - [x] basis = completion
  - [x] title / priority / url / tags の引き継ぎ
  - [x] 終了条件（COUNT / UNTIL）の判定
- [x] Item 詳細での繰り返し設定UI
- [x] 一覧での繰り返しアイコン表示
- [x] 系列の過去オカレンスを辿るUI
- [x] 繰り返しの停止
- [x] SmartAdd の `*` 対応
- [x] ショートカット `r`

### 完了条件

RTM で管理している繰り返しタスク（every / after の両方）を、
挙動を変えずにこのサービスへ移せること。
