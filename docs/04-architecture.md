# 04. 技術構成

## 4.1 全体構成

```text
┌─────────────────────────────┐
│  ブラウザ (PC / スマートフォン) │
│    Vue.js + TypeScript       │
└──────────┬──────────────────┘
           │  ① API 呼び出し
           ▼
┌─────────────────────────────┐        ┌──────────────┐
│  Vercel                      │        │              │
│   - 静的アセット配信          │───────▶│  Neon        │
│   - Functions (API)          │  SQL   │  PostgreSQL  │
└──────────┬──────────────────┘        └──────────────┘
           │  ② 署名付きURL発行
           ▼
┌─────────────────────────────┐
│  Amazon S3 (画像)            │◀─── ③ ブラウザから直接アップロード
└─────────────────────────────┘
```

| レイヤ | 採用 |
|---|---|
| ホスティング / API | **Vercel** |
| DB | **Neon** (PostgreSQL) |
| フロントエンド | **Vue.js + TypeScript** |
| 画像ストレージ | **Amazon S3** |

## 4.2 選定理由

### Vercel

- フロントエンドのホスティングと API（Functions）を1つのプラットフォームで完結できる
- Git 連携によるデプロイが単純で、個人開発の運用コストが低い
- Neon との連携（Vercel Marketplace / 環境変数の自動注入）が容易

### Neon

- PostgreSQL 互換であり、データの取り出しやすさ・移行しやすさが高い
- サーバーレス環境（Vercel Functions）からの接続を前提に設計されている
- Supabase は無料枠のプロジェクト数を使い切っているため候補から外した

### Vue.js + TypeScript

- 使い慣れた構成であること
- TypeScript により、Item / Section / Diary の型をフロントとAPIで共有できる

### Amazon S3

- 長期的な安定性
- 一般的なオブジェクトストレージであり、将来的な移行がしやすい
- 画像データとアプリケーションDBのデータを分離できる

## 4.3 フロントエンド

### フレームワーク構成

**Nuxt 4 + Nitro server routes** を採用する（[07-open-questions.md](07-open-questions.md) Q1）。

Vercel 上での API 実装・ルーティング・型共有が一体化され、個人開発で書く総量が減るため。

### 一覧の共通化

一覧は `ItemListView` に集約する。取得・カーソル・複数選択・ショートカット・
分割表示（右ペインの詳細）まで、この1コンポーネントが受け持つ。

画面側は絞り込み条件を渡すだけでよく、一覧としての挙動が自然にそろう。
今日 / Inbox / タスクはいずれもこの形。

分割表示を使う画面は `definePageMeta({ wide: true })` を宣言し、
コンテナの最大幅を広げる。

### ローカル先行反映

追加・編集・削除は、サーバーの応答を待たずに画面へ反映する。応答を待って
描き直すと、押してから見た目が変わるまでの間が空き、キーボードで続けて
操作するテンポが崩れるため。

- 変更はいったん一覧へ重ねて表示し（`useItemList` の localChanges）、
  送信と取り直しが済んだところで重ねるのをやめる
- 失敗したら重ねた変更を取り消し、エラーを出す
- 並びはクライアントでも計算する（`app/utils/item-order.ts`）。サーバーの
  `ORDER BY` と同じ順序にしないと、取り直しのたびに行が飛ぶ
- 送信は1本の列にまとめる（`useSyncQueue`）。並行に投げると、続けざまの
  操作が投げた順に届かず、最後に書かれる値が入れ替わる

Item の id はクライアントで採番して `POST /api/items` に渡す。追加した直後の
Item に対する操作の宛先が、応答を待たずに決まっている必要があるため。

未完了 / 完了（`h`）の切り替えは、両方をあらかじめ取っておく。
切り替えのたびに取りに行くと、押してから中身が入れ替わるまで間が空く。

### 画面幅による出し分け

見た目だけでなく挙動も変わる場合（一覧の分割表示など）は、CSS だけでなく
`useSplitLayout()`（`matchMedia`）で判定する。広い画面では右ペインに詳細を出し、
狭い画面では詳細画面へ遷移する、という分岐が必要なため。

### 状態管理・ルーティング

- ルーティング: Nuxt のファイルベースルーティング
- 状態管理: Pinia。ただし規模が小さいうちは composable のみで足りる可能性が高い
- スタイル: 未確定（Tailwind CSS 等）

### 画面構成（想定）

| 画面 | 内容 |
|---|---|
| 今日 | 期限が今日まで／期限切れの未完了タスク |
| Inbox | 未整理 Item の一覧 |
| Item 一覧 | status 別・期限順の一覧 |
| Item 詳細 | Item のメタデータと、紐づく Section の時系列 |
| Item 追加 | スマートフォンからの最速入力に最適化 |
| Diary | 日付を指定して開く1日1ページの日記 |
| Diary 一覧 | 日付降順の一覧 |
| 検索 | 横断検索（後期マイルストーン） |

## 4.4 バックエンド / API

### 方式

Nitro の server routes（`server/api/`）で REST 的な API を実装する。Vercel 上では Functions として動作する。

GraphQL や tRPC は、個人用途に対して構成が重くなるため採用しない。

### エンドポイント（想定）

| メソッド | パス | 内容 |
|---|---|---|
| GET | `/api/items` | Item 一覧（`status` / `tag` / `untagged` / `dueUntil` / `open` / `series` フィルタ、`sort` でソート軸指定） |
| POST | `/api/items` | Item 作成。1行目を SmartAdd として解釈し、2行目以降は Section にする。`id` を渡せる |
| PATCH | `/api/items` | 複数選択した Item への一括更新 |
| GET | `/api/items/:id` | Item 詳細（Section・タグを含む） |
| PATCH | `/api/items/:id` | Item 更新（タイトル / status / priority / url / due_at / 繰り返し） |
| DELETE | `/api/items/:id` | Item 削除。Undo 用に削除内容を返す |
| POST | `/api/items/restore` | 削除した Item の復元（Undo 専用） |
| POST | `/api/items/tags` | 複数 Item へのタグの付け外し（`add` / `remove`） |
| GET | `/api/tags` | タグ一覧（Item 件数つき） |
| PATCH | `/api/tags/:id` | タグのリネーム |
| DELETE | `/api/tags/:id` | タグの削除 |
| POST | `/api/sections` | Section 作成 |
| PATCH | `/api/sections/:id` | Section 更新（本文のリアルタイム保存で呼ばれる） |
| DELETE | `/api/sections/:id` | Section 削除 |

| GET | `/api/diaries/:date` | 指定日の Diary 取得 |
| PUT | `/api/diaries/:date` | Diary の upsert |
| GET | `/api/diaries` | Diary 一覧 |
| GET | `/api/days/:date/items` | 指定日に作業した Item 一覧（Section 経由） |
| POST | `/api/uploads` | S3 への署名付きアップロードURLを発行 |
| GET | `/api/search` | 横断検索（後期マイルストーン） |

クイックメモ専用のエンドポイントは設けない。クイックメモも SmartAdd も
「1行目を解釈して Item を作る」処理は同じで、分けると同じロジックが二重になるため。

すべてのエンドポイントで認証を必須とする（Vercel の Deployment Protection による）。

### エラー応答

エラーメッセージは `createError` の **`message`** に入れる。`statusMessage` は
HTTP のステータス行に載るため、日本語が壊れる（h3 も将来サニタイズすると警告している）。
クライアントは `error.data.message` を読む。

### DB アクセス

**Drizzle ORM** を採用する（[07-open-questions.md](07-open-questions.md) Q2）。
TypeScript の型がスキーマから導出でき、生成物が軽く、SQL に近いため移行時の負担が小さい。

ドライバは環境で使い分ける。

| 環境 | ドライバ | 理由 |
|---|---|---|
| 本番 (Vercel) | `drizzle-orm/neon-serverless` | WebSocket 経由。サーバーレスでコネクションが枯渇しない |
| ローカル開発 | `drizzle-orm/node-postgres` | Docker のローカル PostgreSQL に TCP 接続する |

`neon-http` ではなく `neon-serverless` を使う。**`neon-http` はトランザクションに対応しておらず**、
Item と Section をまとめて作る処理（クイックメモの作成）が本番で失敗するため。

通常の `pg` による TCP コネクションプールは Vercel Functions のライフサイクルと相性が悪いため、本番では使わない。
`DATABASE_URL` のホスト名で判定して切り替える。

### マイグレーション

Drizzle Kit で SQL ファイルベースのマイグレーションを生成し、リポジトリで管理する。
スキーマ定義は `server/db/schema.ts`、生成物は `drizzle/`。DDL は [02-data-model.md](02-data-model.md) を参照。

本番への適用は**手動**とする（手順は [README](../README.md) の「本番へのデプロイ」）。
スキーマ変更の頻度が低く、変更時には必ず自分が居るため、破壊的な変更を目視で止められる方を採る。

自動化するなら GitHub Actions（`main` への push 時）を採る。Vercel の Build Command に
混ぜる案は、Preview デプロイのビルドまで本番DBへ DDL を打つため採らない。
ただし Actions にしても Vercel のデプロイとの順序は保証されないので、
「先に流す」という規律は結局必要になる。適用の手間より、その規律の方が本質。

## 4.5 画像 / S3

### バケット構成

- 単一バケット
- パブリックアクセスは**すべてブロック**する
- オブジェクトキーは推測困難な形式にする（例: `images/{uuid}.{ext}`）
- バージョニングを有効化する（誤削除対策）

### アップロード

API が S3 の署名付きURL（PUT）を発行し、ブラウザが S3 へ直接アップロードする。
Vercel Function を画像バイナリが通過しない構成とする。

署名付き URL には本文のチェックサムを載せない
（`requestChecksumCalculation: 'WHEN_REQUIRED'`）。AWS SDK v3 の既定では
PutObject に CRC32 が付くが、本文を渡さずに署名するここでは「空データの
CRC32」がクエリに入り、ブラウザが実ファイルを PUT した時点で S3 に弾かれる。

### CORS

バケットに CORS を設定し、アプリのドメインからの PUT を許可する。
プリフライト（OPTIONS）は署名なしで飛ぶため、これが無いと IAM や署名が
正しくても 403 になる。

```json
[
  {
    "AllowedOrigins": ["https://<本番ドメイン>"],
    "AllowedMethods": ["PUT"],
    "AllowedHeaders": ["content-type"],
    "MaxAgeSeconds": 3000
  }
]
```

Origin はスキーム・ポートまで含めた完全一致で、末尾スラッシュは付けない。
Preview デプロイはホスト名が変わるため、使うならワイルドカードが要る。

表示側は `/images/<ID>.<拡張子>` から署名付き GET へリダイレクトする形で、
`<img>` が読むだけなので GET の CORS は要らない。

### 配信

未確定。詳細は [07-open-questions.md](07-open-questions.md)。

### 認証情報

IAM ユーザーを作成し、対象バケットへの最小権限（`s3:PutObject` / `s3:GetObject`）のみを付与する。
アクセスキーは Vercel の環境変数で管理する。

## 4.6 環境変数

| 変数 | 用途 |
|---|---|
| `DATABASE_URL` | Neon 接続文字列 |
| `AWS_REGION` | S3 のリージョン |
| `S3_BUCKET` | バケット名 |
| `AWS_ACCESS_KEY_ID` | S3 用 IAM アクセスキー |
| `AWS_SECRET_ACCESS_KEY` | S3 用 IAM シークレット |

認証は Vercel の Deployment Protection で行うため、アプリケーション用の認証関連の環境変数は持たない。

Vercel のプロジェクト設定で管理し、リポジトリにはコミットしない。

## 4.7 環境

| 環境 | 用途 |
|---|---|
| ローカル | 開発。Docker Compose のローカル PostgreSQL を使う（`docker compose up -d`） |
| Production | 本番（Vercel の production デプロイ + Neon） |

個人用途のため Staging 環境は設けない。Vercel の Preview デプロイで代替する。

## 4.8 構成上の前提と注意点

- **ベンダーロックインの回避** — アプリケーションデータは PostgreSQL、画像は S3 に置く。いずれも標準的であり、Vercel / Neon から離れる場合もデータ自体は持ち出せる。
- **Vercel Functions の実行時間制限** — 長時間処理は行わない設計とする。画像アップロードを S3 直送にしているのはこのため。
- **コールドスタート** — 個人利用のため許容する。
