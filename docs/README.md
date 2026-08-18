# 個人用記録サービス 仕様書

自分専用の個人用記録サービス（TODO・作業記録・日記・画像記録の統合）の仕様をまとめたドキュメント群。

## ドキュメント構成

| ファイル | 内容 |
|---|---|
| [01-overview.md](01-overview.md) | 背景・目的・基本方針・最初に検証したい体験 |
| [02-data-model.md](02-data-model.md) | データモデル（**データ構造に関する正） / DDL |
| [03-functional-spec.md](03-functional-spec.md) | 機能仕様（Item / Section / Diary / 画像 / 検索 / 認証） |
| [04-architecture.md](04-architecture.md) | 技術構成（Vercel + Neon + Vue.js + TypeScript + S3） |
| [05-operations.md](05-operations.md) | 非機能要件・バックアップ・長期運用 |
| [06-roadmap.md](06-roadmap.md) | マイルストーンと実装順序 |
| [07-open-questions.md](07-open-questions.md) | 未確定事項・検討が必要な論点 |
| [08-todo-management.md](08-todo-management.md) | TODO管理（RTM相当のソート / ショートカット / SmartAdd） |
| [09-tags.md](09-tags.md) | タグ分類 |
| [10-recurrence.md](10-recurrence.md) | 繰り返しタスク（RTM の every / after） |
| [11-scrapbox-notation.md](11-scrapbox-notation.md) | 本文の記法（Scrapbox 記法） |
| [12-offline.md](12-offline.md) | オフライン対応（IndexedDB / Service Worker / 同期） |

## 基本コンセプト

3つの独立したエンティティで構成する。

- **Item** — TODO・タスクそのもの（タイトル・状態・期限のみ。本文は持たない）
- **Section** — ある Item について「その日に何をしたか」を記録する、日付付きの文章単位
- **Diary** — カレンダーベースの1日1ページの日記

Diary と Section は直接紐付けず、**日付を介して疎結合に関連付ける**。
Item は **Tag** で横断的に分類し、**繰り返し**にも対応する（いずれも Remember The Milk 相当）。
本文は **Scrapbox 記法**のプレーンテキストとして保存する。

## 開発の進め方

まず「スマートフォンから一時的なメモを投げ込める」部分だけを作り、日常利用を開始する。
その後、Remember The Milk 相当の TODO 管理機能を載せる。詳細は [06-roadmap.md](06-roadmap.md)。

## 技術構成（想定）

- ホスティング / API: **Vercel**
- DB: **Neon** (PostgreSQL)
- フロントエンド: **Vue.js + TypeScript**
- 画像ストレージ: **Amazon S3**

## ドキュメントの扱い

- データ構造に関する記述は [02-data-model.md](02-data-model.md) を正とする。他ドキュメントと矛盾した場合はこちらを優先する。
- 未確定事項は [07-open-questions.md](07-open-questions.md) に集約する。各ドキュメント中で確定していない箇所には「未確定」と明記する。
