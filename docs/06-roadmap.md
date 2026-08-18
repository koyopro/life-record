# 06. マイルストーン / TODO

## 実装の優先順位

```text
1. クイックメモ（スマホからの投入 + Inbox）
2. TODO 管理（RTM 相当の操作感）
3. タグ分類
4. 繰り返しタスク
5. Section
6. Diary
7. 画像 (S3)
8. 検索
9. 長期運用・バックアップの強化
```

最初から全機能を実装しない。**Milestone 2（クイックメモ）が完成した時点で実際に日常利用を開始し**、使い勝手を確認する。
その後、実際の利用で不足した機能を優先して追加する。

---

## Milestone 1: 最小構成の決定

目的：実装を開始できる状態にする。

技術スタックの大枠は決定済み（Vercel + Neon + Vue.js + TypeScript + S3）。残りを確定させる。

- [x] フロントエンド構成を確定 → **Nuxt 4**（[07-open-questions.md](07-open-questions.md) Q1）
- [x] DBアクセス方式を確定 → **Drizzle ORM**（Q2）
- [x] 認証方式を確定 → **Vercel Deployment Protection**（Q3）
- [x] ローカル開発用 PostgreSQL を用意（Docker Compose）
- [x] Nuxt プロジェクトを作成
- [x] DBスキーマ定義とマイグレーションの仕組みを導入 → [02-data-model.md](02-data-model.md)
- [ ] Neon プロジェクト作成
- [ ] Vercel プロジェクト作成・Neon 連携
- [ ] Deployment Protection が Production に効くかプランを確認 → Q3
- [ ] 最初のデプロイを通す（疎通確認）

---

## Milestone 2: クイックメモ（Google Keep 的な一時メモ）

**最優先。** スマートフォンから思いついたことを即座に投げ込める部分だけを、最小構成で作る。

このマイルストーンのゴールは機能の網羅ではなく、**「スマホで開いて、書いて、閉じる」が一瞬で終わること**。

### データの扱い

Item は本文を持たないため、クイックメモは以下の組み合わせで表現する（[07-open-questions.md](07-open-questions.md) Q7）。

```text
Item.title   = メモの見出し（1行目）
Section.body = メモの内容（date = 作成日）  ※本文が空なら作らない
Item.status  = inbox
```

### スコープ

- [x] メモ投稿 API（`POST /api/items` — Item + Section を1トランザクションで作成）
- [x] Inbox 一覧 API（`GET /api/items?status=inbox`）
- [x] スマートフォン向けの入力画面
  - [x] 開いた直後に入力欄へフォーカスが当たる（タッチ端末では自動フォーカスしない）
  - [x] 1行目をタイトル、2行目以降を本文として扱う
  - [x] 送信後は即座に入力欄が空になり、続けて書ける
  - [x] 楽観的UI更新（送信完了を待たずに一覧へ反映）
- [x] Inbox 一覧画面（新しい順のカード表示）
- [x] メモの削除（`DELETE /api/items/:id`）

認証は Vercel の Deployment Protection に任せるため、アプリ側の実装は不要。

### スコープ外（Milestone 3 以降で実装）

status 変更 / 期限 / 編集 / 詳細画面 / Section の時系列表示 / 画像 / 検索

> Milestone 3 の実装時に、`/api/memos` は `/api/items` へ統合した。
> クイックメモと SmartAdd は「1行目を解釈して Item を作る」点で同じ処理のため、
> エンドポイントを分けると同じロジックが二重になる。

### 完了条件

スマートフォンから、思いついたことを数秒で投げ込めること。**ここで日常利用を開始する。**

---

## Milestone 3: TODO 管理（Remember The Milk 的な使い勝手）

Milestone 2 で溜まった Inbox を、後から PC で捌けるようにする。
**RTM を置き換えられる操作感にすることがゴール。**

詳細仕様は [08-todo-management.md](08-todo-management.md)。

### 前提となる基本機能

- [x] Item 詳細 API / 画面
- [x] Item 編集（タイトル・期限・重要度）
- [x] status 変更
- [x] status 別の一覧
- [x] Item 削除の確認導線
- [x] タイトル・本文のリアルタイム保存（保存ボタンを置かない）
- [x] Section の作成 / 編集 / 削除 API（本文編集に必要なため前倒し）

### RTM 相当の機能

- [x] `items.priority` をスキーマに定義（初期マイグレーションに含めた）
- [x] 重要度順 → 期限日順のソート（既定）
- [x] ソート軸の切り替えと状態の永続化（localStorage）
- [x] 期限の相対表示・期限切れの強調
- [x] 一覧のカーソル選択（`j` / `k`）
- [x] RTM 準拠のキーボードショートカット
- [x] 複数選択（`x`）と一括操作
- [x] Undo（`u`）
- [x] ショートカット一覧（`?`。定義から自動生成）
- [x] SmartAdd（`^` 期限 / `!` 重要度）
- [x] SmartAdd の入力中プレビュー
- [x] スマートフォン向けの代替操作（右スワイプで完了・長押しでメニュー）
- [x] 「今日」リスト（期限が今日まで／期限切れ・重要度順→期限降順）
- [x] PC での分割表示（左に一覧、右に詳細）。すべての一覧で共通

### 完了条件

RTM で行っていた日々のタスク管理を、このサービスだけで違和感なく置き換えられること。
特に、一覧を開いてからキーボードだけで整理を終えられること。

---

## Milestone 4: タグ分類

Item を横断的に分類できるようにする。詳細仕様は [09-tags.md](09-tags.md)。

- [x] `tags` / `item_tags` の追加（マイグレーション）
- [x] タグ名の正規化ロジック（サーバー・クライアントで共有）
- [x] Item にタグを付ける / 外す API（複数選択にも対応）
- [x] タグ一覧 API（Item 件数つき）
- [x] タグのリネーム / 削除 API（リネーム時の衝突は統合で吸収）
- [x] 参照が0になったタグの削除
- [x] Item 一覧のタグ絞り込み（単一タグ / タグなし）。すべての一覧で共通
- [x] タグ入力欄と候補表示
- [x] Item カードへのタグ表示（押すとそのタグで絞り込む）
- [x] ショートカット `t` / `Shift` + `t`
- [x] SmartAdd の `#` 対応

### 完了条件

RTM で使っているタグ運用を、そのまま持ち込めること。

---

## Milestone 5: 繰り返しタスク

RTM の every / after 両方の繰り返しに対応する。詳細仕様は [10-recurrence.md](10-recurrence.md)。

- [x] `recurrence_rule` / `recurrence_basis` / `series_id` の追加（マイグレーション）
- [x] RRULE のパースと次回発生日の計算
- [x] 自然言語（日本語・英語）→ RRULE の変換
- [x] RRULE → 自然文の表示
- [x] 完了時に次回オカレンスを生成する処理
  - [x] basis = due（過去日になる場合は未来まで進める）
  - [x] basis = completion
  - [x] title / priority / tags の引き継ぎ
  - [x] 終了条件（COUNT / UNTIL）の判定
- [x] Item 詳細での繰り返し設定UI
- [x] 一覧での繰り返しアイコン表示
- [x] 系列の過去オカレンスを辿るUI
- [x] 繰り返しの停止
- [x] SmartAdd の `*` 対応
- [x] ショートカット `r`

### 完了条件

RTM で管理している繰り返しタスクを、挙動を変えずに移せること。

---

## Milestone 6: Section

目的：Item に対する日々の作業記録を残せるようにする。

- [ ] Section 作成（Item + 日付を指定）
- [ ] Section 編集
- [ ] Section 削除
- [ ] Item 詳細画面での Section の時系列表示
- [ ] `position` による並び替え
- [ ] 当日の Section をすばやく追加する動線

### 完了条件

1つの TODO について、複数日にまたがる作業の経緯が読み返せること。

---

## Milestone 7: Diary

- [ ] Diary の取得 / upsert API
- [ ] 日付を指定して開く画面
- [ ] Diary 編集
- [ ] Diary 一覧（日付降順）
- [ ] カレンダー / 日付ナビゲーション
- [ ] 「その日に作業した Item」の自動表示（Section の日付から導出）
- [ ] Item 詳細から、Section の日付に対応する Diary へのリンク

### 完了条件

日記を書く習慣が成立し、日記とTODOを日付で行き来できること。

---

## Milestone 8: 画像アップロード

- [ ] S3 バケット作成（パブリックアクセス全ブロック・バージョニング有効）
- [ ] IAM ユーザー / 最小権限ポリシー作成
- [ ] CORS 設定
- [ ] 署名付きアップロードURL発行 API
- [ ] 画像の配信方式を確定 → [07-open-questions.md](07-open-questions.md) Q4
- [ ] ドラッグ&ドロップによる画像追加（Section / Diary 両方）
- [ ] スマートフォンからの画像追加（選択・撮影）
- [ ] 本文への Scrapbox 記法での埋め込みと表示（[11-scrapbox-notation.md](11-scrapbox-notation.md) 11.7）
- [ ] 孤児オブジェクトの扱いを整理（初期は許容）

---

## Milestone 9: 検索・整理機能

- [ ] Item.title の検索
- [ ] Section.body の検索
- [ ] Diary.body の検索
- [ ] 横断検索の結果表示UI（日付順に混在表示）
- [ ] status フィルタ
- [ ] 日付フィルタ
- [ ] 全文検索インデックスの検討（データ量が増えてきた場合）

---

## Milestone 10: 長期運用対応

- [ ] `pg_dump` による定期バックアップ
- [ ] バックアップの実行方式を確定 → [07-open-questions.md](07-open-questions.md) Q5
- [ ] S3 バックアップ / 複製方針の実装
- [ ] データエクスポート機能（JSON / テキスト）
- [ ] 復元手順の確認と文書化
- [ ] 定期的なバックアップ確認の運用を決める

---

## Milestone 11 以降（将来検討）

- PWA 対応（スマートフォンのホーム画面追加）
- Section への時刻の付与
- リッチテキスト / ブロック構造での保存
- 画像メタデータ管理テーブル
- タグの階層化・タググループ
- タグの AND / OR 絞り込み
- Scrapbox 記法の拡張（テーブル・アイコン・ページリンク）
