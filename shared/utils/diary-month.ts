/**
 * 月のページのアドレス（docs/11-scrapbox-notation.md 11.11）。
 *
 * `/diary/2026-09` にはしない。日付のリンク `/diary/2026-09-01` の前方一致に
 * なるため、この月を指しているものを本文から引く（バックリンク）ときに、
 * その月の日記リンクまで巻き込んでしまう。`month/` を挟むと、後ろに何も
 * 続かない形になり、部分一致のままで正しく引ける。
 *
 * 画面と記法（パーサ）とサーバーで同じ形を使うため、組み立てはここに置く。
 */
export function diaryMonthPath(month: string): string {
  return `/diary/month/${month}`
}
