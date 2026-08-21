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

## 現在地（2026-08-19）

Milestone 1〜12 の機能実装は、以下を除いて完了している。

**動いているもの**

- Vercel + Neon で稼働。**Preview 環境を主に使い**、Vercel Deployment Protection で保護している（Q3）
- 画像は本番の S3 で上げ下げできている（Milestone 8）
- PWA としてインストールでき、オフラインでも TODO を読み書きできる（Milestone 11）
- OS の共有シートから Inbox に入れられる（Milestone 12）

**残っている作業**

| | 内容 | 置き場所 |
|---|---|---|
| 1 | 画像バケットのバージョニング有効化・別リージョンへの複製 | Milestone 10 |
| 2 | 全文検索インデックスの検討（データ量が増えたら。Q9） | Milestone 9 |

DBバックアップ本体（S3 バケット・GitHub Secrets・復元の実演）は完了した。
1 は画像側の保護強化、2 は必要になってからでよい。

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
- [x] Neon プロジェクト作成
- [x] Vercel プロジェクト作成・Neon 連携
- [x] Deployment Protection が Production に効くかプランを確認 → Q3
      → **Preview 環境を主に使う**ことで解決。Preview は Hobby プランでも
      Deployment Protection の対象になるため、有料プランに上げずに保護できている
- [x] 最初のデプロイを通す（疎通確認）

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
  - [x] ~~開いた直後に入力欄へフォーカスが当たる~~
    → 自動フォーカスはやめた。一覧のキーボード操作（`j` / `k` など）が
    入力欄に吸われるため、入力欄へ移るのは `t` を押したときだけにする
    （[08-todo-management.md](08-todo-management.md) 8.4）
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
- [x] RTM 準拠のキーボードショートカット（本家の一覧と照合して割り当てを確定）
- [x] 複数選択（`x`）と一括操作
- [x] Undo（`u`）
- [x] ショートカット一覧（`?`。定義から自動生成）
- [x] SmartAdd（`^` 期限 / `!` 重要度）
- [x] SmartAdd の入力中プレビュー
- [x] スマートフォン向けの代替操作（右スワイプで完了・長押しでメニュー・
      チェックしたタスクをまとめて操作する帯）
- [x] 「今日」リスト（期限が今日まで／期限切れ・重要度順→期限降順）
- [x] PC での分割表示（左に一覧、右に詳細）。すべての一覧で共通
- [x] タスクの URL（`Shift` + `u` で別タブに開く）

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
- [x] ショートカット `s`（RTM の「タグを変更」）
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
- [x] ショートカット `f`（RTM の「くり返し設定を変更」）

### 完了条件

RTM で管理している繰り返しタスクを、挙動を変えずに移せること。

---

## Milestone 6: Section

目的：Item に対する日々の作業記録を残せるようにする。

- [x] Section 作成（Item + 日付を指定）
- [x] Section 編集
- [x] Section の日付の変更
- [x] Section 削除
- [x] Item 詳細画面での Section の時系列表示
- [x] `position` による並び替え（同一日付内）
- [x] 当日の Section をすばやく追加する動線（`Shift` + `y`）

### 完了条件

1つの TODO について、複数日にまたがる作業の経緯が読み返せること。

---

## Milestone 7: Diary

- [x] Diary の取得 / upsert API
- [x] 日付を指定して開く画面
- [x] Diary 編集（本文はリアルタイム保存）
- [x] Diary 一覧（日付降順）
- [x] 日付ナビゲーション（前日 / 翌日 / 今日 / 日付を選ぶ）
- [x] 「その日に作業した Item」の自動表示（Section の日付から導出）
- [x] Item 詳細から、Section の日付に対応する Diary へのリンク

### 完了条件

日記を書く習慣が成立し、日記とTODOを日付で行き来できること。

---

## Milestone 8: 画像アップロード

- [x] 画像の配信方式を確定 → [07-open-questions.md](07-open-questions.md) Q4
- [x] 署名付きアップロードURL発行 API（`POST /api/images`）
- [x] 表示の解決（`GET /images/<ID>.<拡張子>` → 302 → 署名付き取得URL）
- [x] ドラッグ&ドロップ・貼り付けによる画像追加（Section / Diary 両方）
- [x] スマートフォンからの画像追加（選択・撮影）
- [x] 本文への Scrapbox 記法での埋め込みと表示（[11-scrapbox-notation.md](11-scrapbox-notation.md) 11.7）
- [x] 開発用の S3 互換ストレージ（compose.yaml の MinIO）
- [x] 孤児オブジェクトの扱いを整理（初期は許容）

### AWS 側の設定（完了）

ローカルは MinIO、本番は S3 で、実際に画像を上げて表示できることを確認済み。

- [x] S3 バケット作成（パブリックアクセス全ブロック・バージョニング有効）
- [x] IAM ユーザー / 最小権限ポリシー作成（対象は `<bucket>/images/*`、
      許可は `s3:PutObject` と `s3:GetObject` のみ）
- [x] CORS 設定（`PUT` を、アプリのオリジンからのみ許可する）
- [x] Vercel に `S3_BUCKET` / `S3_REGION` / `S3_ACCESS_KEY_ID` /
      `S3_SECRET_ACCESS_KEY` を設定（`S3_ENDPOINT` は設定しない）

### 孤児オブジェクト

本文から画像の記法を消しても、S3 のオブジェクトは残る。
初期実装ではこれを許容する（[03-functional-spec.md](03-functional-spec.md) 3.5）。

個人利用の量では実害がなく、消す仕組みを持つと「まだ他の本文から
参照されている画像を消してしまう」危険のほうが大きいため。
必要になった時点で、本文を走査して未参照のものを見つける方式を検討する。

---

## Milestone 9: 検索・整理機能

- [x] Item.title の検索
- [x] Section.body の検索
- [x] Diary.body の検索
- [x] 横断検索の結果表示UI（日付順に混在表示）
- [x] 対象の限定（タスク名 / 作業記録 / 日記）
- [x] status フィルタ
- [x] 日付フィルタ
- [x] ショートカット `/`（検索へ）
- [x] タグでの絞り込み（[03-functional-spec.md](03-functional-spec.md) 3.6）
- [ ] 全文検索インデックスの検討（データ量が増えてきた場合）
      → [07-open-questions.md](07-open-questions.md) Q9

---

## Milestone 10: 長期運用対応

- [x] バックアップの実行方式を確定 → [07-open-questions.md](07-open-questions.md) Q5
- [x] `pg_dump` による定期バックアップ（`.github/workflows/backup.yml`）
- [x] データエクスポート機能（`/api/export` / `?format=text`）
- [x] 復元手順の文書化 → [05-operations.md](05-operations.md) 5.4
- [x] 定期的なバックアップ確認の運用を決める（四半期に1度、復元まで通す）

### 残っている作業（AWS / GitHub の設定）

- [x] バックアップ用の S3 バケット作成（**画像用とは別にする**）
- [x] GitHub Secrets の登録（`DATABASE_URL` / `BACKUP_S3_BUCKET` /
      `BACKUP_AWS_REGION` / `BACKUP_AWS_ACCESS_KEY_ID` /
      `BACKUP_AWS_SECRET_ACCESS_KEY`）
- [ ] 画像バケットのバージョニング有効化・別リージョンへの複製
- [x] **復元を1度通す**（[05-operations.md](05-operations.md) 5.4）。
      2026-08-19、S3上のダンプ（`datalake-20260819.dump`）をローカルの
      Docker PostgreSQL へ `pg_restore` で復元し、件数を確認済み
      （items 40 / sections 22 / diaries 2 / tags 3）。
      5.4 の手順では Neon の新規ブランチへの復元としているが、今回は
      ダンプの整合性・復元可能性の確認を優先してローカルで実施した。
      四半期ごとの確認では Neon ブランチでの復元も試す

---

## Milestone 11: オフライン対応（完了）

電波の悪い場所でも TODO を見て書けるようにする。
詳細は [12-offline.md](12-offline.md)。

- [x] IndexedDB に TODO の写しと未送信の操作を持つ（`idb`）
- [x] ローカルへ先に反映し、送信は列にためて後から流す
- [x] Service Worker でアプリを起動できるようにする（`@vite-pwa/nuxt`）
- [x] ホーム画面へ追加できるようにする（manifest / アイコン）
- [x] 競合の検出（サーバー優先・検出したら知らせる）
- [x] 再送で二重登録にならないようにする（API の冪等化）

## Milestone 12: 共有からの取り込み（完了）

スマートフォンの共有シートから、見ているページをそのまま Inbox に入れられるようにする。
詳細は [13-share-target.md](13-share-target.md)。

- [x] manifest の `share_target`（`GET /share`）
- [x] 受付画面（`app/pages/share.vue`。一覧と同じ入力欄を使う）
- [x] 受け取った `url` / `title` / `text` の組み立て（`shared/utils/share.ts`）
- [x] 1行目の裸の URL を Item の url 欄へ移す（SmartAdd と共通）
- [x] 保存は一覧と同じ経路（オフラインでも保存でき、後から送られる）
- [x] 開き直しに備えて受け取った内容を `sessionStorage` に10分だけ控える
- [x] インストールできる状態にする（`<VitePwaManifest />` / `useCredentials`）
- [x] Android 実機での確認（[13-share-target.md](13-share-target.md) 13.7）

---

## Milestone 13: ホーム画面アイコンからの追加（完了）

ホーム画面のアイコンを長押しして、そのまま書き始められるようにする。
詳細は [14-app-shortcuts.md](14-app-shortcuts.md)。

- [x] manifest の `shortcuts`（「タスクを追加」→ `/add`）
- [x] 追加だけをする画面（`app/pages/add.vue`。一覧と同じ入力欄を使う）
- [x] 開いた時点で入力欄へフォーカスする（`ItemComposer` の `autofocus`）
- [x] 追加は一覧・共有と同じ経路（オフラインでも追加でき、後から送られる）
- [ ] Android 実機での確認（[14-app-shortcuts.md](14-app-shortcuts.md) 14.5）

---

## Milestone 14 以降（将来検討）

- Section・日記のオフライン対応（いまは TODO 本体のみ）
- Section への時刻の付与
- リッチテキスト / ブロック構造での保存
- 画像メタデータ管理テーブル
- タグの階層化・タググループ
- タグの AND / OR 絞り込み
- Scrapbox 記法の拡張（テーブル・アイコン・ページリンク）
