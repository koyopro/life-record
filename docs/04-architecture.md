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

### フレームワーク構成（未確定）

Vue.js を使うことは確定。その上での構成として2案ある。

| 案 | 構成 | 特徴 |
|---|---|---|
| A | Vite + Vue 3 (SPA) + Vercel Functions | 構成が単純。フロントとAPIが明確に分離される |
| B | Nuxt 3/4 + Nitro (server routes) | Vercel との親和性が高く、API も同一プロジェクトで完結。SSR による初期表示の速さ |

**推奨は B（Nuxt）。** Vercel 上での API 実装・ルーティング・型共有が一体化され、個人開発の総量が減るため。
ただし、個人用途で SSR の必要性は低く、A のほうが構成としては薄い。この選択は [07-open-questions.md](07-open-questions.md) で確定させる。

### 状態管理・ルーティング

- ルーティング: Vue Router（Nuxt 採用時はファイルベースルーティング）
- 状態管理: Pinia。ただし規模が小さいうちは composable のみで足りる可能性が高い
- スタイル: 未確定（Tailwind CSS 等）

### 画面構成（想定）

| 画面 | 内容 |
|---|---|
| Inbox | 未整理 Item の一覧。最初に開く画面 |
| Item 一覧 | status 別・期限順の一覧 |
| Item 詳細 | Item のメタデータと、紐づく Section の時系列 |
| Item 追加 | スマートフォンからの最速入力に最適化 |
| Diary | 日付を指定して開く1日1ページの日記 |
| Diary 一覧 | 日付降順の一覧 |
| 検索 | 横断検索（後期マイルストーン） |

## 4.4 バックエンド / API

### 方式

Vercel の Functions（Nuxt 採用時は Nitro の server routes）で REST 的な API を実装する。

GraphQL や tRPC は、個人用途に対して構成が重くなるため採用しない。

### エンドポイント（想定）

| メソッド | パス | 内容 |
|---|---|---|
| GET | `/api/items` | Item 一覧（status 等でフィルタ） |
| POST | `/api/items` | Item 作成 |
| GET | `/api/items/:id` | Item 詳細（Section を含む） |
| PATCH | `/api/items/:id` | Item 更新（タイトル / status / due_at） |
| DELETE | `/api/items/:id` | Item 削除 |
| POST | `/api/sections` | Section 作成 |
| PATCH | `/api/sections/:id` | Section 更新 |
| DELETE | `/api/sections/:id` | Section 削除 |
| GET | `/api/diaries/:date` | 指定日の Diary 取得 |
| PUT | `/api/diaries/:date` | Diary の upsert |
| GET | `/api/diaries` | Diary 一覧 |
| GET | `/api/days/:date/items` | 指定日に作業した Item 一覧（Section 経由） |
| POST | `/api/uploads` | S3 への署名付きアップロードURLを発行 |
| GET | `/api/search` | 横断検索（後期マイルストーン） |

すべてのエンドポイントで認証を必須とする。

### DB アクセス

Neon への接続は、サーバーレス環境を考慮して以下のいずれかを用いる。

- `@neondatabase/serverless`（HTTP / WebSocket 経由。コネクション枯渇の心配が少ない）
- Drizzle ORM または Prisma（Neon の serverless driver 経由）

**推奨は Drizzle ORM + `@neondatabase/serverless`。** TypeScript の型がスキーマから導出でき、生成物が軽く、SQL に近いため移行時の負担が小さい。

通常の `pg` による TCP コネクションプールは、Vercel Functions のライフサイクルと相性が悪いため避ける。

### マイグレーション

SQL ファイルベースのマイグレーションをリポジトリで管理する（Drizzle Kit 等）。
DDL は [02-data-model.md](02-data-model.md) を参照。

## 4.5 画像 / S3

### バケット構成

- 単一バケット
- パブリックアクセスは**すべてブロック**する
- オブジェクトキーは推測困難な形式にする（例: `images/{uuid}.{ext}`）
- バージョニングを有効化する（誤削除対策）

### アップロード

API が S3 の署名付きURL（PUT）を発行し、ブラウザが S3 へ直接アップロードする。
Vercel Function を画像バイナリが通過しない構成とする。

CORS 設定で、Vercel のドメインからの PUT を許可する必要がある。

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
| （認証関連） | 認証方式の確定後に定義する |

Vercel のプロジェクト設定で管理し、リポジトリにはコミットしない。

## 4.7 環境

| 環境 | 用途 |
|---|---|
| ローカル | 開発。Neon のブランチ機能で開発用DBを分離する |
| Production | 本番（Vercel の production デプロイ） |

個人用途のため Staging 環境は設けない。Vercel の Preview デプロイで代替する。

## 4.8 構成上の前提と注意点

- **ベンダーロックインの回避** — アプリケーションデータは PostgreSQL、画像は S3 に置く。いずれも標準的であり、Vercel / Neon から離れる場合もデータ自体は持ち出せる。
- **Vercel Functions の実行時間制限** — 長時間処理は行わない設計とする。画像アップロードを S3 直送にしているのはこのため。
- **コールドスタート** — 個人利用のため許容する。
