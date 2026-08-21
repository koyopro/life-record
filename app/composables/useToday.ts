import { toAppDate } from '~~/shared/utils/date'

/**
 * 「今日」（YYYY-MM-DD）。日付が変わったら自分で切り替わる。
 *
 * 作業記録は当日の枠に書き込む（docs/03-functional-spec.md 3.2）ため、
 * どの日を「今日」と見るかが画面の状態になる。`toAppDate()` をその場で
 * 呼ぶだけだと、開いたまま日付をまたいだときに前日の枠へ書き足してしまう
 * ――まさに直したかった「複数日に跨って本文を更新した」状態になる。
 *
 * 秒単位の精度は要らないので、1分ごとと、画面へ戻ってきたときに見直す。
 * タイムゾーンは固定（Asia/Tokyo）なので、サーバー描画とクライアントで
 * 食い違わない。
 */
const CHECK_INTERVAL_MS = 60_000

export function useToday(): Ref<string> {
  const today = useState<string>('today', () => toAppDate())

  if (import.meta.client) {
    const sync = () => {
      const now = toAppDate()
      if (now !== today.value) today.value = now
    }

    let timer: ReturnType<typeof setInterval> | null = null

    onMounted(() => {
      sync()
      timer = setInterval(sync, CHECK_INTERVAL_MS)
      document.addEventListener('visibilitychange', sync)
      window.addEventListener('focus', sync)
    })

    onBeforeUnmount(() => {
      if (timer) clearInterval(timer)
      document.removeEventListener('visibilitychange', sync)
      window.removeEventListener('focus', sync)
    })
  }

  return today
}
