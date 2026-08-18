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
  },

  /*
   * PWA（docs/12-offline.md 12.2）。
   *
   * Service Worker が受け持つのはアプリの起動だけ。TODO の中身は
   * IndexedDB に置き、Cache Storage には入れない。
   */
  pwa: {
    registerType: 'autoUpdate',
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
       * 新しい版を入れたら、古いキャッシュは残さず、待たずに入れ替える。
       * 古い Service Worker が居座ると、消えた JS を読もうとして壊れる。
       */
      cleanupOutdatedCaches: true,
      clientsClaim: true,
      skipWaiting: true,
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
        // スマートフォンでの表示を基準にする
        {
          name: 'viewport',
          content: 'width=device-width, initial-scale=1, viewport-fit=cover',
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
