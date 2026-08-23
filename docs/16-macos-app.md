# 16. macOS アプリ（Tauri）

Web 版と同じ Life Record を、macOS の1つのアプリとして開けるようにする。

```text
┌──────────────────────────────┐
│ Life Record.app (Tauri)      │
│  ┌────────────────────────┐  │      アプリ内のリンク
│  │ WKWebView              │──┼───▶ そのまま WebView の中で開く
│  │  = デプロイ先の Nuxt   │  │
│  └────────────────────────┘  │      外部リンク・mailto:
│         on_navigation ───────┼───▶ macOS の既定のブラウザ / メール
└──────────────────────────────┘
```

Tauri はネイティブの入れ物に徹する。画面と機能は Web 版そのままで、
`app/` 以下には何も足していない。Web 版（Vercel）のふるまいも変わらない。

## 16.1 何を表示するか

Nitro の API（`server/`）が要るので、書き出した静的ファイルを .app に
同梱することはできない。ウィンドウには **動いている Life Record の URL** を
出す。

| | 行き先 |
|---|---|
| `npm run tauri:dev` | `http://localhost:3000`（手元の dev サーバー） |
| `npm run tauri:build` | `LIFE_RECORD_APP_URL`（未指定なら `http://localhost:3000`） |

配布する .app はデプロイ先を指すことになるので、ビルド時に URL を渡す。

```bash
LIFE_RECORD_APP_URL="https://<デプロイ先>" npm run tauri:build
```

サイト全体を Vercel の Deployment Protection で守っているため
（[07-open-questions.md](07-open-questions.md) Q3）、アプリからも最初に
Vercel の認証画面が出る。認証は Cookie に残るので、通るのは初回だけ。

この認証は `https://vercel.com/sso-api?…` へのリダイレクトで始まる。
別 origin なので、16.2 の判定をそのまま当てるとブラウザへ出てしまい、
Cookie がブラウザ側に付いて WebView は白いままになる。認証をアプリの中で
終わらせるため、`vercel.com` だけは例外として中で開く
（`url_rules.rs` の `AUTH_HOSTS`）。

## 16.2 外部 URL は既定のブラウザで開く

WebView の中に外部サイトが出ないようにする。開く先は macOS のユーザー設定に
従う（Safari などを名指ししない。`tauri-plugin-opener` に URL を渡すだけ）。

| URL | 開く場所 |
|---|---|
| Life Record 自身（同一 origin） | Tauri のウィンドウの中 |
| `https://vercel.com/…`（認証の経由先。16.1） | Tauri のウィンドウの中 |
| `http:` / `https:` の別 origin | macOS の既定のブラウザ |
| `mailto:` `tel:` `sms:` `facetime:` | macOS の既定のアプリ |
| それ以外（`file:` や独自スキーム） | 開かない |

判定は Rust 側（`src-tauri/src/url_rules.rs`）だけが持つ。移動の直前に
呼ばれる `on_navigation` で判定し、外部なら移動を取り消して OS へ渡す
（`src-tauri/src/main.rs`）。

## 16.3 新しいタブ・ウィンドウを開こうとするリンク

本文の外部リンクやタスクの URL は `target="_blank"`、一覧の `o` は
`window.open()` で開いている。WKWebView ではこの2つが「新しいウィンドウを
作ってよいか」の問い合わせになり、`on_navigation` を通らないことがある。

そこで **同じウィンドウの移動に直してから** Rust 側の判定へ載せる。
Tauri のウィンドウにだけ注入する小さなスクリプト
（`src-tauri/src/open-external.js`）が、

- `target` の付いたリンクのクリック
- `window.open(url)`

を拾って `window.location.href` に置き換える。外部 URL なら Rust 側が
その移動を取り消し、既定のブラウザが開く。アプリ内の URL ならそのまま移る。

このスクリプトは Tauri のウィンドウにしか入らない。ブラウザで開いた
Web 版には何も注入されないので、そちらの `target="_blank"` は今まで通り
新しいタブで開く。

## 16.4 権限

WebView にネイティブの権限を渡していない（`capabilities/default.json` の
`permissions` は空）。画面から任意の URL をネイティブ API へ流し込む経路が
無いので、URL を開けるのは Rust 側の判定を通ったものだけになる。

`file:` や見知らぬ独自スキームは OS へ渡さない。「http 以外はすべて OS へ」
としてしまうと、本文に書いたリンクを踏んだだけで手元のファイルや別のアプリを
起こせてしまう。渡すスキームは `url_rules.rs` に列挙したものだけにする。

## 16.5 メニュー（再読み込み）

WebView にはブラウザのような再読み込みの導線が無く、Tauri の既定のメニュー
（`Menu::default`）にも入っていない。表示しているのは動いている Nuxt
そのもの（16.1）なので、読み込みに失敗したときに開き直せる入り口を1つ置く。

- **View > 再読み込み**（`⌘R`）で WebView を読み直す（`WebviewWindow::reload`）
- 既定のメニューは組み直さず、そこにある「View」へ足すだけにする
  （`src-tauri/src/main.rs` の `build_menu`）

Web 版は変わらない。ブラウザの `⌘R` は元々効くので、`app/` 側には何も足さない。

## 16.6 開発とビルド

| コマンド | 内容 |
|---|---|
| `npm run dev` | これまで通り。ブラウザで `http://localhost:3000` |
| `npm run tauri:dev` | dev サーバーを起こし、Tauri のウィンドウで開く |
| `npm run tauri:build` | `.app` と `.dmg` を作る（`src-tauri/target/release/bundle/`） |

`npm run tauri:*` は `scripts/tauri.mjs` を通る。`LIFE_RECORD_APP_URL` を
tauri の設定へ渡すためだけの入れ物で、他は Tauri CLI にそのまま流す。

必要なもの（macOS）:

- Rust（`rustup`）
- Xcode Command Line Tools

`.app` に署名はしていない。手元で作って手元で使う前提のため、初回だけ
Finder から「開く」で許可する。

判定の単体テストは Rust 側にある。

```bash
cd src-tauri && cargo test
```
