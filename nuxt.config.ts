// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  compatibilityDate: '2025-07-15',
  devtools: { enabled: true },
  css: ['~/assets/css/main.css'],
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
