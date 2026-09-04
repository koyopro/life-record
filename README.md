# datalake

個人用記録サービス。TODO・作業記録・日記・画像記録を1つにまとめる。

仕様は [docs/](docs/) を参照。まずは [docs/README.md](docs/README.md) から。

## 技術構成

| レイヤ | 採用 |
|---|---|
| フレームワーク | Nuxt 4 (Vue 3 + TypeScript) |
| オフライン | IndexedDB（`idb`）+ Service Worker（`@vite-pwa/nuxt`） |
| API | Nitro server routes |
| DB | PostgreSQL（本番: Neon / 開発: Docker） |
| ORM | Drizzle ORM |
| ホスティング | Vercel |
| macOS アプリ | Tauri v2（Web 版をそのまま包むだけ） |
| 画像ストレージ | Amazon S3（開発: MinIO / Docker） |

## 開発環境のセットアップ

```bash
# 1. 依存関係をインストール
npm install

# 2. 環境変数を用意
cp .env.example .env

# 3. 開発用の PostgreSQL と S3 互換ストレージ（MinIO）を起動
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
| `npm run tauri:dev` | macOS アプリ（Tauri）として開発サーバーを開く |
| `npm run tauri:build` | macOS アプリ（`.app` / `.dmg`）をビルド |
| `npm test` | テスト（vitest） |
| `npm run db:generate` | スキーマ定義からマイグレーションSQLを生成 |
| `npm run db:migrate` | マイグレーションを適用 |
| `npm run db:studio` | Drizzle Studio でDBを閲覧 |
| `npm run import:rtm` | Remember The Milk の書き出し（JSON）から取り込む |
| `npm run import:backup` | `/api/export` の JSON から取り込み直す（docs/05-operations.md 5.4） |

取り込みはどちらも `-- <ファイル>` で渡し、`--dry-run` を付ければ DB に書かずに
中身だけ確かめられる。RTM の書き出しには**ゴミ箱のタスクも含まれる**ので、
取り込みでは除く（前に取り込んでしまった分は `--prune-trashed` で消せる）。

## ディレクトリ構成

```text
app/                  Nuxt アプリケーション（画面）
  pages/              ファイルベースルーティング
  components/
  composables/
  utils/offline/      IndexedDB とサーバーへの同期（docs/12-offline.md）
server/               Nitro server routes（API）
  api/
  routes/             API 以外の経路（画像の解決など）
  db/                 Drizzle のスキーマ定義と接続
  utils/
shared/               画面と API で共有する型・処理
tests/                テスト（vitest）
drizzle/              生成されたマイグレーションSQL
src-tauri/            macOS アプリの入れ物（Tauri / docs/16-macos-app.md）
docs/                 仕様書
```

## macOS アプリ

Tauri v2 で、Web 版と同じ Life Record を macOS のアプリとして開ける。
画面と機能は Web 版そのままで、Tauri はネイティブの入れ物に徹する
（`app/` 以下には何も足していない）。

```bash
# 手元の dev サーバーを Tauri のウィンドウで開く
npm run tauri:dev

# 本番（デプロイ先）を指す .app / .dmg
npm run tauri:build:prod

# 行き先を指定して作る（プレビュー環境など）
LIFE_RECORD_APP_URL="https://<デプロイ先>" npm run tauri:build
```

外部サイトへのリンクは WebView の中には出さず、macOS で設定されている
既定のブラウザで開く。仕組みは [docs/16-macos-app.md](docs/16-macos-app.md)。

## オフライン

TODO はブラウザの IndexedDB にも保存し、オフラインでも一覧・追加・編集・
状態変更ができる。行った操作は列にたまり、繋がったときに順に送られる。
アプリ本体は Service Worker が持つので、圏外でも起動できる。

サーバーの DB が正本で、IndexedDB はその写しと未送信の操作の置き場。
仕組みと方針（競合の扱い・再送・テスト）は
[docs/12-offline.md](docs/12-offline.md) を参照。

Service Worker は本番ビルドでのみ動く。手元で確かめるときは
`npm run build && npm run preview` してから、DevTools の Network を
Offline にする。

## 画像

本文の画像は S3 に置き、本文には `[/images/<ID>.<拡張子>]` だけを書く。
開発環境では compose.yaml の MinIO が S3 の代わりになるので、AWS の
バケットがなくても動く（http://localhost:9001 が MinIO のコンソール）。

本番で使うには AWS 側の設定が要る。手順は
[docs/06-roadmap.md](docs/06-roadmap.md) Milestone 8 を参照。

## 本番へのデプロイ

コードは Vercel が `main` への push で自動デプロイする。
**マイグレーションは自動では流れない**ので、スキーマを変更したときは手元から適用する。

```bash
# Neon の direct 接続文字列（-pooler が付かない方）を使う。
# pooler 経由では DDL が通らないことがある
DATABASE_URL="postgres://...@ep-xxxx.aws.neon.tech/neondb?sslmode=require" \
  npx drizzle-kit migrate
```

`drizzle.config.ts` は `.env` を読むが、`process.loadEnvFile()` は既存の環境変数を
上書きしないため、上のように前置きすればローカルDBへ誤って適用されることはない。

デプロイとの前後関係は自分で担保する。新しいカラムを使うコードを先に出すと、
適用までの間だけ本番が 500 を返す。迷ったら**マイグレーションを先に流す**。

## バックアップとエクスポート

DB は GitHub Actions で毎日 `pg_dump` を取り、S3 へ置く
（`.github/workflows/backup.yml`）。手元へ取り出したいときは以下。

| URL | 形式 |
|---|---|
| `/api/export` | JSON |
| `/api/export?format=text` | プレーンテキスト |

復元手順は [docs/05-operations.md](docs/05-operations.md) 5.4。

## 認証

Vercel の Deployment Protection でサイト全体を保護する方針のため、アプリケーション側には認証を実装していない。

> **公開前の確認事項:** Hobby プランでは Deployment Protection が Preview デプロイのみ対象で、
> Production を保護できない可能性がある。公開前に必ず確認すること。
> 詳細は [docs/07-open-questions.md](docs/07-open-questions.md) Q3。
