# 18. Claude からの読み書き（MCP）

Claude（claude.ai / Claude アプリ / Claude Code）から、タスク・作業記録・日記を
読み書きできるようにする。アプリに **MCP サーバー**（`/mcp`）を持たせ、Claude の
**カスタムコネクタ**として登録する。

## 18.1 構成

```text
Claude ──HTTPS──▶ Vercel（Deployment Protection）──▶ /mcp ──内部呼び出し──▶ /api/...
          ?x-vercel-protection-bypass=…   ＋ ヘッダー Authorization: Bearer …
```

- 方式は MCP の **Streamable HTTP**。セッションを持たない（stateless）。
  Vercel Functions はリクエストごとに別のインスタンスへ行きうるため
- 応答はストリームにせず JSON で返す（`enableJsonResponse`）
- ツールは既存の API（`/api/...`）を Nitro の `$fetch` で呼ぶだけにする。
  検証・冪等性・完了時の繰り返し生成は API 側にあり、ここで持ち直すと画面から
  操作したときと結果がずれるため
- 実装は `server/routes/mcp.ts`（入口と認証）と `server/mcp/server.ts`（ツール）

## 18.2 認証

サイト全体は Vercel の Deployment Protection で守っている（[07-open-questions.md](07-open-questions.md) Q3）。
Claude はそのログインを通れないので、鍵を2つ使う。

| 鍵 | 置き場所 | 役割 |
|---|---|---|
| Protection Bypass for Automation の秘密 | Vercel が発行 | Deployment Protection を通る。URL のクエリ `x-vercel-protection-bypass` |
| `MCP_TOKEN` | Vercel の環境変数 | `/mcp` を開ける。`Authorization: Bearer`（クエリ `token` でも可） |

バイパスの秘密は**サイト全体の鍵**（`/api` にも届く）。`/mcp` だけ別の鍵でも閉じておき、
どちらか片方が漏れただけでは MCP から読み書きされないようにする。

- `MCP_TOKEN` が未設定なら `/mcp` は 404（機能ごと無効）
- 比較は `timingSafeEqual`
- `MCP_TOKEN` は**リクエストヘッダー**（`Authorization`）で渡す。claude.ai のカスタムコネクタは
  認証を「サインインなし」にするとヘッダーを足せ、値は保存後に再表示されない
- バイパスの秘密は **URL のクエリ**に載せる。claude.ai では独自のヘッダー名
  （`x-vercel-protection-bypass`）に Anthropic の承認が要り、承認の無い名前ではコネクタを
  追加できないため。`Authorization` は標準のヘッダーなので使える
- そのため **URL にはバイパスの秘密が入る**。人に見せない。漏れてもそれだけでは `/mcp` は
  開かないが、`/api` には届くので、Vercel で秘密を作り直す
- `MCP_TOKEN` はクエリ `token` でも受ける。ヘッダーを足せないクライアント向けの逃げ道

OAuth（コネクタ標準の認可フロー）は実装しない。単一ユーザーで、アプリ側に
ログインの仕組みを持たない方針（Q3）と釣り合わないため。

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

1. Vercel のプロジェクト設定 → Deployment Protection →
   **Protection Bypass for Automation** で秘密を発行する（Hobby プランでも使える）
2. Vercel の環境変数に `MCP_TOKEN` を足す（Preview に効かせる）。値は長いランダム文字列
   （例: `openssl rand -hex 32`）
3. 再デプロイする
4. Claude の 設定 → コネクタ → **カスタムコネクタを追加** で次のように入れる。
   ホストは日常使っている Preview のブランチ URL（デプロイごとに変わらない方）にする

   - URL: `https://<preview のホスト>/mcp?x-vercel-protection-bypass=<バイパスの秘密>`
   - 認証: **サインインなし**（OAuth は実装していない）
   - リクエストヘッダー: `Authorization` に `Bearer <MCP_TOKEN>`
     （ヘッダー名の選択肢から Authorization を選ぶ。カスタムヘッダーにはしない）
5. 会話で「今日のタスクを見せて」などと頼んで、ツールが呼ばれることを確かめる

Claude Code からは次で足せる。

```bash
claude mcp add --transport http life-record "https://<preview のホスト>/mcp" --header "x-vercel-protection-bypass: <秘密>" --header "Authorization: Bearer <MCP_TOKEN>"
```

### 鍵を替えるとき

- `MCP_TOKEN` を替えたら再デプロイし、コネクタの URL を直す
- バイパスの秘密は Vercel 上で作り直せる。古い秘密は消すと即座に効かなくなる

## 18.5 ローカルでの確認

`.env` に `MCP_TOKEN` を入れて `npm run dev` し、`http://localhost:3000/mcp?token=…` に
MCP Inspector（`npx @modelcontextprotocol/inspector`）などで繋ぐ。
ツールの振る舞いは `tests/mcp.spec.ts` で押さえている。
