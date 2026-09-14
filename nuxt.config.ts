// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  compatibilityDate: '2025-07-15',
  devtools: { enabled: true },
  css: ['~/assets/css/main.css'],
  modules: ['@vite-pwa/nuxt'],

  routeRules: {
    /*
     * オフライン時に Service Worker が返す殻（app/pages/offline-shell.vue）。
     * SSR せずに静的な HTML として書き出し、Service Worker に持たせる。
     */
    '/offline-shell': { ssr: false, prerender: true },
    /*
     * タスク一覧は `/items` から `/` へ移した（Inbox との統合に伴う）。
     * ブックマークや Service Worker が持っている古い URL を拾う。
     * 詳細（`/items/:id`）はそのままなので、ここだけを移す。
     */
    '/items': { redirect: { to: '/', statusCode: 301 } },
  },

  /*
   * PWA（docs/12-offline.md 12.2）。
   *
   * Service Worker が受け持つのはアプリの起動だけ。TODO の中身は
   * IndexedDB に置き、Cache Storage には入れない。
   */
  pwa: {
    /*
     * 新しい版は、こちらから合図するまで当てない。
     *
     * 既定の `'autoUpdate'` は、新しい版が入った瞬間に読み込み直す。タスクを
     * 書いている最中でも起きるので、打ちかけの入力が消え、キャレットも飛ぶ。
     * `'prompt'` にすると新しい Service Worker は待つだけになり、いつ当てるかを
     * アプリ側で決められる（app/composables/useAppUpdate.ts）。書きかけが
     * 無くなってから当てるので、人の目に付く動きは変わらない。
     */
    registerType: 'prompt',
    /*
     * manifest の取得に Cookie を付ける（`crossorigin="use-credentials"`）。
     *
     * サイト全体を Vercel の Deployment Protection で守っているため
     * （docs/07-open-questions.md Q3）、Cookie の付かない取得には認証の画面が
     * 返る。既定では manifest だけが Cookie 無しで取得されるので、これを
     * 付けないとブラウザは manifest を読めず、インストールできない。
     */
    useCredentials: true,
    manifest: {
      name: 'datalake',
      short_name: 'datalake',
      description: '個人用記録サービス',
      lang: 'ja',
      // ホーム画面から開いたら「今日」を出す
      start_url: '/today',
      scope: '/',
      display: 'standalone',
      background_color: '#f6f6f4',
      theme_color: '#f6f6f4',
      /*
       * OS の共有シートから URL を受け取る（docs/13-share-target.md）。
       *
       * 受付は manifest だけで済む。共有された内容はクエリで /share に
       * 渡ってくるので、Service Worker には何も足さない。
       */
      share_target: {
        action: '/share',
        method: 'GET',
        params: { title: 'title', text: 'text', url: 'url' },
      },
      /*
       * ホーム画面アイコンの長押しから出る項目（docs/14-app-shortcuts.md）。
       *
       * 置くのは「開いてすぐ書き始めたい」ものだけにする。読むだけなら
       * アイコンを普通に押せば済むので、長押しの先から選ぶ手間に見合わない。
       *
       * 日記は日付ごとに URL が違うが、manifest には日付を書けない
       * （登録した日のまま固定される）。開いた時点の日付へ振り分ける
       * /diary/today を行き先にする。
       */
      shortcuts: [
        {
          name: 'タスクを追加',
          short_name: '追加',
          description: '入力欄を開いた状態で起動する',
          url: '/add',
          icons: [
            { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
          ],
        },
        {
          name: '今日の日記を開く',
          short_name: '日記',
          description: '今日の日記を開いた状態で起動する',
          url: '/diary/today',
          icons: [
            { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
          ],
        },
      ],
      icons: [
        { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
        { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
        {
          src: '/icon-512.png',
          sizes: '512x512',
          type: 'image/png',
          purpose: 'maskable',
        },
      ],
    },
    workbox: {
      // アプリの起動に要るものだけを持つ
      globPatterns: ['**/*.{js,css,html,ico,png,svg,woff,woff2}'],
      // 画面への移動はすべて殻で受ける（API と画像は素通し）
      navigateFallback: '/offline-shell',
      navigateFallbackDenylist: [/^\/api\//, /^\/images\//],
      /*
       * 古い版のキャッシュは、入れ替えるときに消す。
       * 居座らせると、消えた JS を読もうとして壊れる。
       *
       * ただし**待たずに入れ替えない**（`skipWaiting: false`）。新しい
       * Service Worker が勝手に主導権を取ると、いま開いている画面は古い JS を
       * 読みに行くのに、その控えはもう消えている、という食い違いが起きる。
       * 入れ替えの合図は useAppUpdate が送り、そのまま読み込み直す。
       */
      cleanupOutdatedCaches: true,
      clientsClaim: true,
      skipWaiting: false,
    },
    client: {
      // 個人用なのでインストールの誘導は出さない
      installPrompt: false,
    },
  },

  app: {
    head: {
      titleTemplate: '%s | datalake',
      meta: [
        /*
         * スマートフォンでの表示を基準にする。
         *
         * interactive-widget=resizes-content は、画面キーボードが出たときに
         * 表示領域そのものを縮める指定。これがないと、下端に固定している
         * 入力欄（ItemComposer のシート）がキーボードの裏に隠れる。
         */
        {
          name: 'viewport',
          content:
            'width=device-width, initial-scale=1, viewport-fit=cover, interactive-widget=resizes-content',
        },
        // 実際の値は表示中のテーマに合わせて ThemeToggle が差し替える
        { name: 'theme-color', content: '#f6f6f4' },
      ],
      htmlAttrs: { lang: 'ja' },
      script: [
        {
          /*
           * 保存した明暗の指定を、描画される前に反映する。
           * Vue の起動を待つと、端末の設定のままの色が一瞬見えてしまう。
           * 鍵の名前は app/composables/useTheme.ts と合わせている。
           */
          innerHTML: `try{var t=localStorage.getItem('theme');if(t==='light'||t==='dark')document.documentElement.dataset.theme=t}catch(e){}`,
          tagPosition: 'head',
        },
      ],
    },
  },
})
