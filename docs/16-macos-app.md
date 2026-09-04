# 16. macOS アプリ（Tauri）

Web 版と同じ Life Record を、macOS の1つのアプリとして開けるようにする。

```text
┌──────────────────────────────┐
│ Life Record.app (Tauri)      │
│ ┌─タブ─┬─タブ─┬─タブ─┐    │      アプリ内のリンク
│ │ WKWebView（1タブ = 1つ）│──┼───▶ そのまま WebView の中で開く
│ │  = デプロイ先の Nuxt    │   │      （`⌘`+クリックなら新しいタブ）
│ └─────────────────────────┘   │      外部リンク・mailto:
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
| 本文に埋め込むページ（`EMBED_HOSTS`。下記） | Tauri のウィンドウの中（iframe として） |
| `http:` / `https:` の別 origin | macOS の既定のブラウザ |
| `mailto:` `tel:` `sms:` `facetime:` | macOS の既定のアプリ |
| それ以外（`file:` や独自スキーム） | 開かない |

判定は Rust 側（`src-tauri/src/url_rules.rs`）だけが持つ。移動の直前に
呼ばれる `on_navigation` で判定し、外部なら移動を取り消して OS へ渡す
（`src-tauri/src/main.rs`）。

### 埋め込み（iframe）は例外にする

`on_navigation` には**フレームの区別が渡ってこない**。wry は
`decidePolicyForNavigationAction` の URL だけを渡すので、本文の埋め込み
（`[URL]`、[11-scrapbox-notation.md](11-scrapbox-notation.md) 11.12）が読み込む
URL も「別 origin への移動」として来る。そのまま外部として扱うと、
**埋め込みの枠は空のまま、そのページがブラウザで開いてしまう**。

そこで、埋め込みとして出す host（`url_rules.rs` の `EMBED_HOSTS`）だけを
**直接の移動に限って**中で通す（`route_navigation`）。

- 一覧は画面側（`shared/utils/scrapbox/parse.ts` の `IFRAME_HOSTS`）と同じもの。
  片方だけ増やすと、記法は埋め込みになるのにアプリではブラウザが開く、という
  食い違いになる
- **リンクを押したときは変わらない。** `target="_blank"` のリンクは
  `open-external.js` 経由（16.3）で来るので、そちらは埋め込み先でも
  これまでどおりブラウザで開く
- 完全一致・`https` だけ。副ドメインや後ろに足したものは通さない
- 埋め込みは `sandbox` 付きで、こちらの画面を動かす権限は渡していない
  （11.12）。中のページがアプリのタブを乗っ取ることはない

## 16.3 新しいタブ・ウィンドウを開こうとするリンク

本文の外部リンクやタスクの URL は `target="_blank"`、`Shift`+`u` は
`window.open()` で開いている。WKWebView ではこの2つが「新しいウィンドウを
作ってよいか」の問い合わせになり、`on_navigation` を通らないことがある。

そこで **同じウィンドウの移動に直してから** Rust 側の判定へ載せる。
Tauri のウィンドウにだけ注入する小さなスクリプト
（`src-tauri/src/open-external.js`）が、

- `target` の付いたリンクのクリック
- `⌘` + クリック（ブラウザと同じ手触りにする）
- `window.open(url)`

を拾い、自分と同じ origin の `/__open?url=…` への移動に置き換える。
**どこで開くかはスクリプトでは決めない。**Rust 側がその移動を取り消し、
1つずつ `route`（16.2）にかけて振り分ける。

| 渡された URL | 開く場所 |
|---|---|
| 外部（`http(s)` の別 origin・`mailto:` など） | macOS の既定のアプリ |
| Life Record 自身 | **新しいタブ**（16.10） |
| それ以外（`file:` など） | 開かない |

このスクリプトは Tauri のウィンドウにしか入らない。ブラウザで開いた
Web 版には何も注入されないので、そちらの `target="_blank"` は今まで通り
新しいタブで開く。

### 一度に何件も渡されるとき

一覧の `Shift`+`u`（[08-todo-management.md](08-todo-management.md) 8.4）は、
チェックしたタスクの数だけ `window.open()` を呼ぶ。**移動は1つしか持てない**
ので、そのたびに `location` を書き換えると最後の1つに上書きされ、1件しか
開かなかった。

同じ流れで渡された分は**1回の移動にまとめる**（`/__open?url=…&url=…`）。
Rust 側が受け取って1つずつに戻す（`url_rules.rs` の `handoff`）。

- どこで開くかは**1つずつ `route` が決める**。まとめて渡ってきても、
  判定を通ったものしか開かない決まり（16.5）は変わらない
- 拾うのは自分と同じ origin から来たものだけ。外部のページがこの道を騙っても
  拾わない
- この道への移動は必ず取り消すので、`/__open` のページは要らない

## 16.4 画像の表示

本文の画像は S3 にあり、出すまでに「リダイレクトを引く → S3 から読む」の
2往復が要る。ブラウザなら一度読んだものが手元に残るが、**WebView では
それが当てにならず**、一度見た画像でも表示までの間があった。

いまは画像の中身をアプリ側（IndexedDB）に控えている
（[11-scrapbox-notation.md](11-scrapbox-notation.md) 11.7「中身を手元に控える」）。
2回目からは通信せずに出るので、この画面でも待たされない。macOS アプリの
ためだけの作りではなく、ブラウザ・PWA でも同じように効く。

## 16.5 権限

WebView にネイティブの権限を渡していない（`capabilities/default.json` の
`permissions` は空）。画面から任意の URL をネイティブ API へ流し込む経路が
無いので、URL を開けるのは Rust 側の判定を通ったものだけになる。

`file:` や見知らぬ独自スキームは OS へ渡さない。「http 以外はすべて OS へ」
としてしまうと、本文に書いたリンクを踏んだだけで手元のファイルや別のアプリを
起こせてしまう。渡すスキームは `url_rules.rs` に列挙したものだけにする。

## 16.6 メニュー

WebView にはブラウザのような導線（再読み込み・新規タブ）が無く、Tauri の
既定のメニュー（`Menu::default`）にも入っていない。表示しているのは動いて
いる Nuxt そのもの（16.1）なので、最低限の入り口をこちらで足す。

| 場所 | 項目 | 打鍵 |
|---|---|---|
| File | 新規タブ | `⌘T` |
| View | 再読み込み | `⌘R`（`WebviewWindow::reload`） |
| Window | 次のタブ / 前のタブ | `⌘⇧]` / `⌘⇧[` |

- 既定のメニューは**組み直さず、そこにある入れ物へ足すだけ**にする
  （`src-tauri/src/main.rs` の `build_menu`）。標準の項目（コピー・最小化・
  `⌘W` で閉じる）をそのまま残すため
- 効く先は**いま前面にあるタブ**。タブごとに別の WebView なので、掴む相手を
  決め打ちにできない（`get_focused_window`）
- タブの移動は、macOS が自動で足す `⌃⇥` とは別に、ブラウザと同じ打鍵を
  用意する（16.10）

Web 版は変わらない。ブラウザの `⌘R` や `⌘T` は元々効くので、`app/` 側には
何も足さない。

## 16.7 画像のドラッグ＆ドロップ

日記や作業記録の本文へ画像を落とすと、ブラウザと同じようにアップロードして
本文に差し込む（[03-functional-spec.md](03-functional-spec.md) 3.5）。

**Tauri のドロップの横取りを止める**（`disable_drag_drop_handler`）。
既定では Tauri がドロップを受け取り、ファイルのパスを `tauri://drag-drop`
として Rust 側へ送るだけになる。その間 WebView には `drop` が届かないので、
落としても何も起きなかった。

止めると macOS の既定の動き（WKWebView が受ける）に戻り、`drop` の
`dataTransfer.files` がそのまま届く。**アップロードの経路はブラウザと同じ**で、
`app/` 側には何も足していない。

- パスをネイティブ側で読まないので、WebView へファイルを読む権限（16.5）を
  渡さずに済む。開ける URL の判定（16.2）も変わらない
- `tauri://drag-drop` は使っていない（画面は Tauri の JS API を持たない）ので、
  止めて失うものは無い
- Web 版・PWA は元から WebView の外なので、この設定に関係なく今までどおり
- 入力欄の外（本文以外の場所）へ落としたときは、WebView がその画像へ移ろうと
  する（ブラウザで画像を新しいタブに開くのと同じ動き）。これは `file:` として
  16.2 の判定に載り、**開かない**ので、落とし損ねてアプリが画像表示に
  すり替わることはない

## 16.8 確認ダイアログ（`confirm()` は使わない）

削除の前の「よろしいですか？」は、**アプリの中のダイアログ**で出す
（`app/components/ConfirmDialog.vue` と `useConfirm`）。

ブラウザの `confirm()` は **WKWebView では何も出ない**。wry は WKUIDelegate の
JavaScript ダイアログ（alert / confirm / prompt）を実装しておらず、実装が
無いとき WebKit はパネルを出さずに false を返す決まりのため。`confirm()` の
戻りで進む・戻るを決めていると、**押しても何も起きない操作**になる
（リストの削除がそうなっていた）。

- 出し先は app.vue に1つだけ置く（ImageViewer と同じ）。呼ぶ側は
  `await ask({ message, confirmLabel, danger })` で答えを待つ
- キャンセルは「キャンセル」・`Esc`・背景。開いたら実行する側のボタンへ
  フォーカスするので、`Enter` でそのまま進める
- 削除のような取り返しの付かない操作は `danger` で赤くする
- ブラウザでも同じダイアログになる。見え方を揃えられるので、WebView の
  ためだけの作りではない

`alert()` も同じ理由で出ない。使っていない（知らせは画面の中に出す）。

## 16.9 開発とビルド

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

## 16.10 タブ

**1タブ = 1ウィンドウ = 1 WebView** にして、タブとしてのまとまりは
**macOS のウィンドウタブ**に任せる（`tabbing_identifier`）。

こうすると、タブバー・並べ替え・「タブを新しいウィンドウへ」・フルスクリーンの
扱いが全部 OS のものになり、**画面側（`app/`）には何も足さずに済む**
（この章の前置きの方針）。画面側にタブ UI を作ると、Web 版にもタブバーが出て
ブラウザのタブと二重になる。

### 開き方

| したこと | 結果 |
|---|---|
| File > 新規タブ（`⌘T`） | アプリの先頭を新しいタブで開く |
| アプリの中のリンクを `⌘`+クリック / `target="_blank"` | その行き先を新しいタブで開く（16.3） |
| `⌘W` | そのタブを閉じる（既定のメニューのまま） |
| `⌘⇧]` / `⌘⇧[` | 隣のタブへ移る |

新しいタブは、**いま前面にあるタブの隣**へ入れる（`addTabbedWindow`）。

### タブの見出し

見出しは**その画面の題**（`document.title`）にする。ネイティブのウィンドウの題は
作るときに決めたまま変わらないので、そのままではタブを並べても全部
「Life Record」になり、どれがどれだか分からない。

画面側の題が変わるたびに受け取って、そのタブの題に当てる
（`on_document_title_changed`）。ブラウザのタブと同じ見え方になり、`app/` 側には
何も足さずに済む。

`tabbing_identifier` を付けるだけではタブにならない。tao は `tabbingMode` を
`automatic` のままにするため、macOS の「書類を開くときはタブを使用」が既定
（フルスクリーンのときのみ）だと**別ウィンドウとして開いてしまう**。設定に
左右されないよう、AppKit に直に頼んでタブとして差し込む（`objc2`。tao / wry が
すでに使っている版に合わせているので、依存そのものは増えない）。

タブの移動も AppKit（`selectNextTab:` / `selectPreviousTab:`）に任せる。
自分で順番を持つと、**タブをドラッグして入れ替えたときにずれる**。

### 閉じたあと

`⌘W` で最後のタブまで閉じると、アプリは残るがウィンドウが無くなる。macOS の
作法どおり、Dock のアイコンを押したら開き直す（`RunEvent::Reopen`）。

### 気をつけること

- **タブごとに Nuxt を読み込み直す**（ネットワーク＋起動）。数タブなら問題
  ないが、何十も開く使い方には向かない
- Cookie（Vercel の認証。16.1）も IndexedDB（画像の控え・下書き）も同じ
  origin なので**タブ間で共有**される。ブラウザで複数タブを開いた状態と同じで、
  画面側はもともとそれを前提にしている
  （[12-offline.md](12-offline.md)「別のタブが先に変えている場合」）
- 外部サイトはアプリのタブに入れない。これまでどおり既定のブラウザへ渡す
  （16.2）
