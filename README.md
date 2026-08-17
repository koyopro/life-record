# datalake

個人用記録サービス。TODO・作業記録・日記・画像記録を1つにまとめる。

仕様は [docs/](docs/) を参照。まずは [docs/README.md](docs/README.md) から。

## 技術構成

| レイヤ | 採用 |
|---|---|
| フレームワーク | Nuxt 4 (Vue 3 + TypeScript) |
| API | Nitro server routes |
| DB | PostgreSQL（本番: Neon / 開発: Docker） |
| ORM | Drizzle ORM |
| ホスティング | Vercel |
| 画像ストレージ | Amazon S3（Milestone 6 以降） |

## 開発環境のセットアップ

```bash
# 1. 依存関係をインストール
npm install

# 2. 環境変数を用意
cp .env.example .env

# 3. 開発用 PostgreSQL を起動
docker compose up -d

# 4. マイグレーションを適用
npm run db:migrate

# 5. 開発サーバーを起動
npm run dev
```

http://localhost:3000 で開く。

スマートフォンの実機から確認する場合は `npm run dev -- --host` で起動し、
同一ネットワークから `http://<PCのIP>:3000` を開く。

## スクリプト

| コマンド | 内容 |
|---|---|
| `npm run dev` | 開発サーバー |
| `npm run build` | 本番ビルド |
| `npm run preview` | ビルド結果のプレビュー |
| `npm run db:generate` | スキーマ定義からマイグレーションSQLを生成 |
| `npm run db:migrate` | マイグレーションを適用 |
| `npm run db:studio` | Drizzle Studio でDBを閲覧 |

## ディレクトリ構成

```text
app/                  Nuxt アプリケーション（画面）
  pages/              ファイルベースルーティング
  components/
  composables/
server/               Nitro server routes（API）
  api/
  db/                 Drizzle のスキーマ定義と接続
  utils/
drizzle/              生成されたマイグレーションSQL
docs/                 仕様書
```

## 認証

Vercel の Deployment Protection でサイト全体を保護する方針のため、アプリケーション側には認証を実装していない。

> **公開前の確認事項:** Hobby プランでは Deployment Protection が Preview デプロイのみ対象で、
> Production を保護できない可能性がある。公開前に必ず確認すること。
> 詳細は [docs/07-open-questions.md](docs/07-open-questions.md) Q3。
