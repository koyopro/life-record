# 18. Claude からの読み書き（MCP）

Claude（claude.ai / Claude アプリ / Claude Code）から、タスク・作業記録・日記を
読み書きできるようにする。アプリに **MCP サーバー**（`/mcp`）を持たせ、Claude の
**カスタムコネクタ**として登録する。

## 18.1 構成

```text
Claude ──HTTPS──▶ /mcp（OAuth のアクセストークン）──内部呼び出し──▶ /api/...
```

- 方式は MCP の **Streamable HTTP**。セッションを持たない（stateless）。
  Vercel Functions はリクエストごとに別のインスタンスへ行きうるため
- 応答はストリームにせず JSON で返す（`enableJsonResponse`）
- ツールは既存の API（`/api/...`）を Nitro の `$fetch` で呼ぶだけにする。
  検証・冪等性・完了時の繰り返し生成は API 側にあり、ここで持ち直すと画面から
  操作したときと結果がずれるため
- 実装は `server/routes/mcp.ts`（入口と認証）と `server/mcp/server.ts`（ツール）

## 18.2 認証

OAuth で守る（[19-auth.md](19-auth.md) 19.4）。コネクタは認証を「サインイン」にして追加し、
許可画面でアプリのパスワードを入れる。

以前は Deployment Protection の Bypass の秘密（URL のクエリ）と `MCP_TOKEN`（ヘッダー）で
守っていたが、組織の Claude アカウントで追加すると**組織の全員が同じ鍵で繋がる**ため
やめた（19.1）。

## 18.3 ツール

| ツール | 内容 |
|---|---|
| `search` | タイトル・作業記録・日記の横断検索 |
| `list_items` | タスク一覧（未完了 / 今日まで / タグで絞る）。既定50件、本文は先頭200文字 |
| `get_item` | タスク1件と全作業記録 |
| `create_item` | タスク追加。1行目は SmartAdd の記法、2行目以降は作業記録 |
| `update_item` | タイトル / status / 重要度 / URL / 期限の変更 |
| `set_item_tags` | タグの付け外し |
| `list_tags` | タグ一覧 |
| `reorder_tags` | タグの並べ替え（名前で指定した順を先頭に / 色ごとにまとめる） |
| `set_tag_colors` | タグの色をまとめて変える（名前で指定。無いタグは作らない） |
| `add_work_log` | その日の作業記録に書き足す（無ければ作る） |
| `update_work_log` | 作業記録1件の本文・日付を置き換える |
| `get_diary` | その日の日記と、その日に作業したタスク |
| `list_diaries` | 日記の一覧 |
| `write_diary` | 日記に書く。既定は追記（`mode: replace` で置き換え） |

決めごと:

- **日付は日本時間の `YYYY-MM-DD`**。今日の日付は接続時の instructions で伝える
- 期限は入力も出力も日本時間（`2026-12-01` / `2026-12-01 09:30`）。API の dueAt
  （UTC）をそのまま渡すと、日付だけの期限（23:59 JST = 14:59 UTC）の日付を読み違えやすい
- 書き込みは**追記を既定**にする。会話の流れで書いた内容が、利用者の書いたものを
  消さないようにするため
- 作業記録は1つのタスクにつき1日1件（[03-functional-spec.md](03-functional-spec.md) 3.2）。
  `add_work_log` はその日の最後の記録に書き足す

画面はサーバーから定期的に取り直すので、Claude が書いた内容は次の同期で画面にも出る。

## 18.4 設定手順

アプリのログイン（[19-auth.md](19-auth.md) 19.5）を済ませてから。

1. Claude の 設定 → コネクタ → **カスタムコネクタを追加** で次のように入れる
   - URL: `https://<ホスト>/mcp`
   - 認証: **今すぐサインイン**（OAuth）。リクエストヘッダーは足さない
   - トランスポート: Streamable HTTP（既定のまま）
2. 許可画面が開くので、戻り先が `claude.ai` であることを確かめ、パスワードを入れて「許可する」
3. 会話で「今日のタスクを見せて」などと頼んで、ツールが呼ばれることを確かめる

Claude Code からは次で足せる（初回にブラウザで許可画面が開く）。

```bash
claude mcp add --transport http life-record "https://<ホスト>/mcp"
```

### 止めたいとき

- コネクタだけを外すなら、Claude の設定から削除する
- 渡した鍵をすべて無効にするなら、`AUTH_SECRET` かパスワードを変える（19.2）。
  アプリのログインもやり直しになる

## 18.5 ローカルでの確認

`.env` に `AUTH_SECRET` と `AUTH_PASSWORD_HASH` を入れて `npm run dev` し、
`http://localhost:3000/mcp` に MCP Inspector（`npx @modelcontextprotocol/inspector`）などで繋ぐ
（OAuth の許可画面が開く）。ツールの振る舞いは `tests/mcp.spec.ts`、認証は `tests/auth.spec.ts` で押さえている。
