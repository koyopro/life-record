# 17. ブックマークレットからの取り込み（Amazon）

PC のブラウザで見ている Amazon の商品ページを、そのままタスクにする。

```text
商品ページ → ブックマークバーの「Amazon → タスク」 → /share が開く
          → 内容を確かめる → 保存 → status = backlog の Item
```

買う本を思い付いたときに、タイトルを打ち直したり URL を切り詰めたりせずに
放り込むための導線。共有シート（[13-share-target.md](13-share-target.md)）の
PC 版にあたるもので、**受け口は共有とまったく同じ `/share`**。

作られる Item はこうなる。

| 項目 | 入るもの |
|---|---|
| タイトル | 商品ページの見出し（本のタイトル） |
| url | `https://www.amazon.co.jp/dp/<ASIN>` |
| メモ（`note`） | ページの画像（Scrapbox の画像記法。`[画像URL]`） |
| status / 期限 | 未着手・今日（追加の既定。[08-todo-management.md](08-todo-management.md) 8.5） |

## 17.1 なぜブックマークレットなのか

PC の Chrome には共有シートが無く、Web Share Target も出てこない
（13.6）。拡張機能を作るほどの用ではなく、
**アプリの外で動くものをできるだけ小さく**したい。

ブックマークレットなら、

- ブラウザに登録するのは1回だけ（ブックマークバーに置く）
- 更新に審査も再インストールも要らない（作り直して登録し直すだけ）
- 動くのは商品ページの中の数十行だけで、あとは既存の `/share` に任せられる

## 17.2 受け口（/share）

新しい API も画面も作らない。ブックマークレットは
**共有と同じクエリ**で `/share` を開く。

```text
/share?title=<本のタイトル>&url=https%3A%2F%2Fwww.amazon.co.jp%2Fdp%2FB06XC33Q6S&note=%5B...%5D
```

| クエリ | 中身 |
|---|---|
| `title` | 本のタイトル |
| `url` | 商品の URL |
| `note` | メモ（`Item.note`）にそのまま入る内容 |

`title` と `url` は共有の受付と同じ扱いで、`composeShare` が
「1行目がタイトル、裸の URL は Item の url 欄へ」という形に組み立てる
（13.3）。

### note を足した理由

共有シートが渡してくるのは `url` / `title` / `text` の3つで、`text` は
**2行目以降＝作業記録（Section）** になる。Section は日付を持つため、
そのまま日記に出てしまう（[02-data-model.md](02-data-model.md) 2.8）。

「この本はこういう本」という説明は、その日にやったことではない。
日付を持たない覚え書きは `Item.note`（メモ）の担当なので、
**メモに入れたい経路のために `note` を足す**（2.3）。

共有シートは `note` を渡してこないので、OS からの共有の見た目と動きは
変わらない。

### 追加の経路

保存は一覧の入力欄・共有の受付とまったく同じ経路を通る。

```text
app/pages/share.vue
  → buildItemDraft（app/utils/item-draft.ts。第2引数で note を渡す）
  → useItemStore().create（IndexedDB へ書き、送信は列に積む）
  → /api/items（POST。text と note を受ける）
```

メモは入力テキストには現れないので、送信の列（`CreatePayload`）にも
`note` として別に積む。サーバー側（`server/api/items.post.ts`）は
`text` を SmartAdd として解釈し、`note` はそのまま `items.note` に入れる。
長さの上限は作業記録の本文と同じ（`BODY_MAX_LENGTH`）。

### 受付画面での見え方

`note` が渡ってきたときだけ、入力欄の上に**メモの欄**が出る。

- 画像は記法（`[URL]`）のままでは何が入るか分からないので、**その場で出す**。
  読み方は本文の表示と同じパーサ（`parseScrapbox` / `imagesIn`）に任せる
- 要らない画像は、保存する前にここで消せる
- 渡ってこなければ（OS からの共有）出さない

## 17.3 ブックマークレット（app/utils/bookmarklet.ts）

### 商品ページの中に全部を持っていく

ブックマークレットは**商品ページの中で動く**ので、このアプリのコードは
読み込めない。外から `<script>` を差し込む形にもしない
（Amazon 側の設定で弾かれうるうえ、押すたびに取りに行くことになる）。

そこで `amazonIntakeUrl` を**関数のまま持ち、`toString()` で文字に写して**
`javascript:` に埋める（`buildAmazonBookmarklet`）。

```text
javascript:(function(){
  var u=(<amazonIntakeUrl の中身>)("https://<このアプリ>",document,location.href);
  if(!u){alert(...);return}
  if(!window.open(u,'_blank'))location.href=u;
})()
```

このため **`amazonIntakeUrl` は外の世界に触ってはいけない**。import したもの・
ファイルの他の定数を使うと、写した先には存在せず商品ページで落ちる。
使ってよいのは引数と、その中に書いた関数だけ。

裏返すと、**テストは `amazonIntakeUrl` をそのまま呼べば確かめられる**
（偽の商品ページを組み立てて渡す。`tests/bookmarklet.spec.ts`）。
写したものが動くことも、`new Function` で組み立て直して1つ確かめている。

`javascript:` の中身は URL として読める形にしておく（`encodeURIComponent`）。
空白や引用符がそのままだと、ブックマークの URL 欄に貼りにくい。

### 商品の番号（ASIN）

URL に商品名や `ref=` が付いていても、要るのは ASIN だけ。

1. URL の `/dp/<ASIN>` `/gp/product/<ASIN>` `/gp/aw/d/<ASIN>` など
2. ページの中の `input#ASIN`（URL に出ない入り方のため）
3. `link[rel=canonical]`

どれも見つからなければ**何もしない**（商品ページではない、と判断して
その場で知らせる）。見ているホストが `amazon.*` ならそれを引き継ぐので、
`amazon.com` で押せば `amazon.com` の URL になる。

### タイトル

`#productTitle` を使う。無ければ `og:title`、それも無ければページの題から
`Amazon.co.jp: ` のような店の名前を落として使う。改行と続きの空白は詰める。

### 画像

`[画像URL]` の形で、1行に1枚。

- 主画像（`#landingImage` など）を先頭にし、別カット（`#altImages`）を続ける
- URL は**原寸に直す**。Amazon の画像 URL は
  `.../images/I/<画像ID>._SY466_.jpg` のように拡張子の手前に大きさの指定が
  入るので、これを外す。`data-old-hires`（原寸）があればそちらを使う
- 商品の画像（`/images/I/`）だけを拾う。ボタンや飾り（`/images/G/`）・
  データ URL は入れない
- **4枚まで**。全部入れると「なか見！検索」や関連商品まで並び、メモが
  画像で埋まる

画像そのものは S3 に取り込まない（[11-scrapbox-notation.md](11-scrapbox-notation.md) 11.7 は
自分で上げた画像の話）。Amazon 側の URL をそのまま指す。本が絶版になれば
画像も消えうるが、表紙を確かめるための控えなので、そこまで面倒を見ない。

## 17.4 配る画面（app/pages/bookmarklet.vue）

袖の下段から開く。置くものは3つだけ。

- ブックマークバーへ**引いて持っていくリンク**（`javascript:` の URL）
- 「中身をコピー」（引けないブラウザ用。新しいブックマークの URL 欄に貼る）
- 使い方（3手順）

開く先（`/share`）は、**その画面を見ている場所**（`useRequestURL().origin`）で
組み立てる。置き場は本番・プレビュー・手元（localhost）で違い、押したときに
開くのは**登録した時点の場所**になるので、手元で作ったものが本番を開いて
しまうことがない。

## 17.5 対応環境

- **PC の Chrome / Edge / Safari** … 対応。主要な対象。
  ブックマークバーへ引いて登録する
- **Android Chrome** … ブックマークレットは押せない（アドレスバーから
  ブックマークを開く必要があり、実用に足りない）。スマートフォンでは
  共有シートを使う（13）
- **iOS Safari** … ブックマークとして登録すれば押せるが、確かめていない

## 17.6 動作確認

1. `/bookmarklet` を開き、リンクをブックマークバーへ引く
2. Amazon で本の商品ページを開き、登録したものを押す
3. `/share` が開き、タイトル・`https://www.amazon.co.jp/dp/<ASIN>`・
   表紙の画像が出ることを確認する
4. 「保存」を押すと「保存しました」が出る
5. 開いた Item の**メモ**に画像が入っていること、**作業記録は空**であること、
   その日の日記に出ていないことを確認する
6. Amazon のトップページで押すと、取り込まずに知らせが出ることを確認する
