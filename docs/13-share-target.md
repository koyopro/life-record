# 13. 共有からの取り込み（Web Share Target）

スマートフォンで見ているページを、OS の共有シートからそのまま Inbox に放り込めるようにする。

```text
Chrome でページを見る → 共有 → datalake → 内容を確認 → 保存 → status = inbox の Item
```

「後で整理するために、とりあえず放り込む」ための導線なので、共有してから保存までの
操作をできるだけ増やさない（確認して「保存」を押すだけ）。

## 13.1 受け付け方

Web App Manifest の `share_target` で受ける（nuxt.config.ts の `pwa.manifest`）。

```json
{
  "share_target": {
    "action": "/share",
    "method": "GET",
    "params": { "title": "title", "text": "text", "url": "url" }
  }
}
```

`method: GET` にしているため、共有された内容はクエリとして `/share` に渡ってくる。

```text
/share?url=https%3A%2F%2Fexample.com%2Fa&title=Example%20Page
```

Service Worker には何も足さない。受け付けは manifest だけで済み、`POST` にすると
Service Worker で受け取って渡し直す仕組みが要る（ファイル共有をしないので不要）。

共有先として選べるようになるのは、**ホーム画面に追加（インストール）した場合だけ**。
インストールしていないブラウザ表示でも、`/share` を直接開けば「共有された内容が
ありません」と出るだけで、アプリの他の部分には影響しない。

## 13.2 受付画面（app/pages/share.vue）

出すものは4つだけ。

- 共有された URL（開けるならリンク）・タイトル・text
- 保存する内容の入力欄（一覧と同じ `ItemComposer`）
- 「保存」
- 「保存せずに戻る」

入力欄には組み立てたテキストが入っているので、そのまま「保存」で終われる。
書き直したいときはその場で直せる（SmartAdd の記法もそのまま効く）。

## 13.3 受け取った内容の組み立て（shared/utils/share.ts）

共有元によって、`url` / `title` / `text` のどれが入るかが違う。`composeShare` が
「1行目がタイトル、2行目以降が本文」という既存の入力の形（shared/utils/text.ts）に
そろえる。組み立てたテキストは SmartAdd に渡り、1行目の裸の URL が Item の
`url` 欄に移る（shared/utils/smart-add.ts）。

タイトルは次の順で決める。

1. `title`
2. `text` の1行目（URL を除いた部分）
3. URL の見出し（`example.com/blog/entry` のようにホスト＋パス）

`text` は、タイトルや URL の写しでしかない場合を除いて本文として残す。
`url` が渡されず `text` の中にだけ URL が入っている共有元もあるため、
その場合は `text` から URL を取り出して `url` 欄に回す。

| 受け取ったもの | タイトル | url | 本文 |
|---|---|---|---|
| url + title | title | url | なし |
| url + title + text | title | url | text |
| url + text | text の1行目 | url | 2行目以降 |
| url のみ | URL の見出し | url | なし |
| text のみ（URL 入り） | URL を除いた部分 | text 内の URL | 残り |
| text のみ（URL なし） | 1行目 | なし | 2行目以降 |
| title のみ | title | なし | なし |

タイトルが空・URL が `http(s)` でない（`content://` など）場合でも保存できる。
共有の時点で外部サイトへページタイトルを取りに行くことはしない（共有はすぐ終わらせたい）。

## 13.4 保存

保存は一覧の入力欄と同じ経路を通る。共有のためのデータモデルは作らない。

```text
app/pages/share.vue
  → buildItemDraft（app/utils/item-draft.ts。一覧の入力欄と共通）
  → useItemStore().create（IndexedDB へ書き、送信は列に積む）
```

- 初期状態は `status = inbox`（buildItemDraft の既定）
- 期限は今日（一覧からの追加と同じ既定。docs/08-todo-management.md 8.5）
- オフラインでも保存でき、送信は繋がったときに行われる（docs/12-offline.md）

保存後は共有元に戻らず、保存できたことが分かる画面を出す（「Item を見る」「Inbox を見る」）。

## 13.5 認証

認証は Vercel の Deployment Protection で行い、アプリ側には実装しない
（docs/07-open-questions.md Q3）。共有で `/share` を開いたとき、保護を通っていなければ
Vercel の認証がアプリより手前で挟まり、認証後に元の URL（クエリを含む）へ戻される。
アプリ側で共有内容を持ち回る必要はない。

そのうえで、保存前に受付画面が開き直された場合に備え、受け取った内容を
同じタブの `sessionStorage` に10分だけ控える。クエリの無い `/share` が開かれたときは
そこから戻す。保存・キャンセルしたら消す。

## 13.6 対応環境

- **Android Chrome** … 対応。主要な対象。
- **iOS / iPadOS Safari** … Web Share Target に未対応（共有シートに出ない）。
  ショートカットアプリなどから `/share?url=...` を開く形なら同じ画面が使える。

ブラウザごとの差を埋めるための作り込みはしない。

## 13.7 実機での確認

1. Android Chrome で本番の URL を開き、「ホーム画面に追加」でインストールする
2. 任意のページで「共有」→ 共有先の一覧に **datalake** が出ることを確認する
3. 選ぶと `/share` が開き、URL とタイトルが表示される
4. 「保存」を押すと「保存しました」が出る
5. Inbox にその Item があり、`status = inbox`・URL が Item の url 欄に入っていることを確認する

インストールせずに確認したいときは、`/share?url=...&title=...` を直接開けば受付画面の
見た目と保存までを試せる。
