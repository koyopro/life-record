import { isOpenableUrl, type ItemDto } from '~~/shared/types/item'

/** 開くのに要るのは URL だけ。一覧の Item からも詳細からも渡せる。 */
type Openable = Pick<ItemDto, 'url'>

export interface OpenableUrls {
  /** 開ける URL。一覧の並びのまま、重複は1つにまとめる。 */
  urls: string[]
  /** 開ける URL を持たなかったタスクの数。 */
  withoutUrl: number
}

/**
 * 選んだタスクから、開ける URL を取り出す（`Shift` + `u`）。
 *
 * 同じ URL が複数のタスクに付いていることがある（同じ記事から作ったタスクなど）。
 * 開きたいのはページであってタスクではないので、重複は落として1つのタブにする。
 */
export function openableUrls(items: Openable[]): OpenableUrls {
  const urls: string[] = []
  let withoutUrl = 0

  for (const item of items) {
    const url = item.url?.trim()
    if (!url || !isOpenableUrl(url)) {
      withoutUrl += 1
      continue
    }
    if (!urls.includes(url)) urls.push(url)
  }

  return { urls, withoutUrl }
}

/**
 * 開いたあとの知らせ。
 *
 * 何件開いたのかと、URL が無くて飛ばしたものがあることを伝える。飛ばしたことを
 * 黙っていると、選んだ数とタブの数が合わない理由が分からない。
 *
 * ブラウザに止められた（ポップアップのブロック）かどうかは数えない。
 * `noopener` を付けて開くと、開けたかどうかに関わらず window.open() は null を
 * 返すため、こちら側からは見分けられない。
 */
export function describeUrlOpen({ urls, withoutUrl }: OpenableUrls): string {
  if (urls.length === 0) {
    return withoutUrl === 1 ? 'このタスクに URL はありません' : 'URL のあるタスクがありません'
  }

  const opened = urls.length === 1 ? 'URL を開いた' : `${urls.length}件の URL を開いた`
  return withoutUrl > 0 ? `${opened}・URL の無い${withoutUrl}件は飛ばした` : opened
}
