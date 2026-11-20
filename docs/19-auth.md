# 19. 認証（自前のログイン）

アプリと MCP（[18-mcp.md](18-mcp.md)）を、**パスワード1つ**で守る。
Vercel の Deployment Protection（[07-open-questions.md](07-open-questions.md) Q3 の旧方針）はやめる。

## 19.1 なぜ自前にしたか

Deployment Protection のままでは、Claude のカスタムコネクタを安全に繋げなかった。

- 組織の Claude アカウントでは、ヘッダーに鍵を入れたコネクタは**組織の全員が同じ鍵で**繋がる。
  個人の TODO が他の人から見えてしまった
- 一人ずつ認証させるには OAuth が要る。だが Claude は OAuth の入口（`/.well-known/...`・
  `/oauth/token`）を Bypass の秘密なしで呼ぶので、Deployment Protection に弾かれる
- 保護から一部のパスだけを外す機能は、Vercel の有料プランでないと使えない

自前にすると、OAuth の入口を開けたまま、ほかを守れる。URL に Bypass の秘密を載せる
必要もなくなり、Hobby プランのまま Production も保護つきで使える。

## 19.2 しくみ

ユーザーは1人なので、**アカウントやユーザーテーブルは持たない**。「パスワードを知っているか」
だけを確かめ、通ったら署名つきの文字列（トークン）を渡す。

| 環境変数 | 内容 |
|---|---|
| `AUTH_SECRET` | トークンの署名に使う秘密。32文字以上（`openssl rand -hex 32`） |
| `AUTH_PASSWORD_HASH` | パスワードのハッシュ（scrypt）。`npm run auth:hash` で作る |

- **両方そろったときだけ認証が有効**になる。無ければ素通し（Deployment Protection で
  守っていた頃と同じ）。設定を入れる前にデプロイしても壊れないようにするため。
  ただし MCP と OAuth の入口は、無効のあいだは 404 にする（鍵なしで開けないため）
- トークンは `v1.<中身>.<署名>`（HMAC-SHA256）。DB に置かず、署名と期限だけで確かめる。
  種類（ログイン・認可コード・アクセス・リフレッシュ・クライアント登録）を中に持ち、
  取り違えて受け付けない
- 署名の鍵は `AUTH_SECRET` と `AUTH_PASSWORD_HASH` から作る。**どちらかを変えると、
  すべての端末のログインと Claude のコネクタが一斉に無効になる**。漏れたかもしれない
  ときはこれで止める
- ハッシュの区切りは `:`。`$` だと `.env` の読み込み（Nuxt）が変数として展開してしまう

実装は `server/auth/core.ts`（署名・パスワード・パスの分類）と `server/auth/oauth.ts`（OAuth）。
どちらも Nitro に依存させず、`tests/auth.spec.ts` から直接確かめる。

## 19.3 アプリのログイン

- `/login` でパスワードを入れると、Cookie（`lr_session`）を発行する。HttpOnly・SameSite=Lax、
  https なら Secure。**有効期間は1年**。PWA でオフラインのまま使う期間があるため
- `server/middleware/auth.ts` がすべてのリクエストを確かめる。通すのはログイン済みの Cookie か、
  MCP のアクセストークン（`Authorization: Bearer`）を持つものだけ
- 守らないのは、ログイン・ログアウト・OAuth の入口・`/mcp`（自分で確かめる）・
  アプリの起動に要る静的ファイル（`/_nuxt/`・殻・manifest・Service Worker・アイコン）だけ
  （`isPublicPath`）。**画面・API・画像（`/images/*`）・書き出し・共有の受け口はすべて守る**
- 弾き方は行き先で変える。API と画像は 401、画面はログインへリダイレクト
- Cookie で通った書き込み（GET 以外）は、`Origin` が同じサイトのときだけ通す（CSRF 対策）
- パスワードを間違えたら応答を1秒遅らせる。総当たりの速度を落とすため。
  回数制限は持たないので、**パスワードは長いものにする**（`auth:hash` は12文字未満を断る）
- ログイン画面は Nuxt の画面にせず、サーバーが素の HTML を返す。ログイン前にアプリの JS を
  読ませないためと、Service Worker が画面遷移をすべて殻で返すため（12-offline.md 12.2）。
  ログイン・OAuth・MCP は殻の対象から外してある（`navigateFallbackDenylist`）
- **ログインが切れたら**: 殻から起きたアプリが API で 401 を受けた時点で、ログインへ移す
  （`app/plugins/auth.client.ts`）。見張るのは `fetch` そのもの。`useFetch` は Nuxt が内部に
  持つ `$fetch` を使うので、`globalThis.$fetch` を差し替えても届かない（ofetch は呼ぶたびに
  `globalThis.fetch` を引くので、こちらは効く）。戻り先は元の画面。未送信の操作は消さない
  （401 は送り直しの対象。sync-runner.ts）ので、ログインし直せばそのまま送られる
- ログアウトは袖の下端。この端末の Cookie を消すだけ。全部を止めたいときは 19.2 のとおり鍵を変える

## 19.4 MCP の OAuth

MCP の認可仕様（2025-06-18）に沿って、このアプリが認可サーバーも兼ねる。
Claude のコネクタは認証を「サインイン」にして追加する。

| 入口 | 内容 |
|---|---|
| `GET /.well-known/oauth-protected-resource` | リソースのメタデータ（RFC 9728） |
| `GET /.well-known/oauth-authorization-server` | 認可サーバーのメタデータ（RFC 8414） |
| `POST /oauth/register` | 動的クライアント登録（RFC 7591） |
| `GET/POST /oauth/authorize` | 許可画面。PKCE（S256）必須 |
| `POST /oauth/token` | 認可コード・リフレッシュトークンをアクセストークンに引き換える |

- `/mcp` はアクセストークンが無ければ 401 と `WWW-Authenticate: Bearer resource_metadata=...` を
  返す。Claude はそれを見て許可画面を開く
- 許可画面では**同じパスワード**を確かめる。アプリにログイン済みなら「許可する」を押すだけ。
  戻り先のホストを画面に出す。知らないサービスがコネクタのふりをして許可を取りに来たときに
  気づけるようにするため。他サイトの枠に埋め込ませない（`X-Frame-Options: DENY`）
- クライアント登録は、登録内容（戻り先）を署名した文字列をそのまま `client_id` にする。
  戻り先は https か、手元（localhost）の http だけ
- 認可コードは5分、アクセストークンは1時間、リフレッシュトークンは90日
- 認可コードは保存しないので、期限内なら理屈の上では二度引き換えられる。ただし PKCE の
  verifier を持つ本人にしか引き換えられないので、コードだけを盗まれても使えない
- MCP のツールは内部で API を呼ぶ。そのときも受け取ったアクセストークンを渡し、
  ミドルウェアを通す（`server/routes/mcp.ts`）

**組織の Claude アカウントで追加しても、パスワードを知らない人は許可を取れない。**
メンバーごとに個別のサインインになる（共有の鍵ではなくなる）。

## 19.5 切り替えの手順

順番を守らないと、一時的に誰でもアクセスできる状態になる。

1. この変更をデプロイする（Deployment Protection は付けたまま。環境変数が無いうちは素通し）
2. パスワードのハッシュと秘密を作り、Vercel の環境変数（Production と Preview）に入れる

   ```bash
   npm run auth:hash
   ```

   ```bash
   openssl rand -hex 32
   ```

3. 再デプロイし、**Preview でログインできることを確かめる**（ログイン画面が出て、
   入れたパスワードで入れる）
4. 確かめてから、Vercel の Deployment Protection を外す
5. Claude のコネクタを追加し直す。URL は `https://<ホスト>/mcp`（クエリなし）、
   認証は「サインイン」。許可画面でパスワードを入れる
6. 古い鍵を消す。Vercel の Protection Bypass for Automation の秘密と、環境変数 `MCP_TOKEN`

すでにインストールしている端末では、Service Worker が古い版のアプリを返すので、
ログインが切れても画面がログインへ移らない（手元の IndexedDB の内容で普段どおり動いて
見え、書いたものは未送信のまま溜まる）。上端の「新しい版があります」で更新するか、
一度スーパーリロードすると新しい版に入れ替わる。
