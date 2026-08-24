import { readCachedImage, saveCachedImage } from '~/utils/offline/image-cache'

/**
 * 一度見た画像を、次からは通信せずに出す（docs/11-scrapbox-notation.md 11.7）。
 *
 * 本文の画像は `<img src="/images/...">` として描かれ、表示までに
 * 「リダイレクトを引く → S3 から読む」の2往復が要る。控えがあればその2往復を
 * まるごと飛ばせるので、手元（IndexedDB）の中身を `blob:` の URL にして
 * `src` を差し替える。
 *
 * 描く場所（本文・作業記録・日記・アイコン）ごとに手を入れず、**出てきた
 * `<img>` を見つけて差し替える**形にする。表示の組み立て方は
 * `shared/utils/scrapbox/render.ts` が持っており、そこに手元の事情
 * （IndexedDB）を混ぜたくないため。
 */

/** 本文に書く画像のパス。これで始まるものだけを扱う。 */
const IMAGE_PREFIX = '/images/'

/** 差し替え済みの印。同じ要素を何度も見に行かないために付ける。 */
const HANDLED_ATTRIBUTE = 'data-cached-image'

/**
 * いま持っている `blob:` の URL（パス → URL）。**入れた順**に並ぶ。
 *
 * 同じ画像は本文の中で何度も出てくるうえ、打つたびに行が描き直される。
 * そのたびに IndexedDB を引くと、読み終わるまでの一瞬だけ絵が消えるので、
 * 一度作った URL は持っておいてそのまま当てる。
 */
const objectUrls = new Map<string, string>()

/**
 * 同時に持っておく数。
 *
 * `blob:` の URL は、取り消すまで中身をメモリに抱えたままになる。
 * アプリを開きっぱなしにして日記を遡り続けると際限なく増えるので、
 * 使ったのが古いものから手放す。手放した画像は、また出てきたときに
 * IndexedDB から作り直せばよい。
 */
const MAX_OBJECT_URLS = 80

/**
 * 取りに行って駄目だったパス。
 *
 * 控えを作るための取得（`fetch`）は、バケットの CORS 設定によっては
 * 通らない（docs/04-architecture.md 4.5）。通らない場所で毎回試すと、
 * 表示のたびに失敗する要求を投げ続けることになるので、一度覚えて諦める。
 */
const failed = new Set<string>()

/** `<img>` が指している、本文の画像のパス。違うものは null。 */
function imagePathOf(img: HTMLImageElement): string | null {
  const src = img.getAttribute('src')
  if (!src || src.startsWith('blob:') || src.startsWith('data:')) return null

  try {
    const url = new URL(src, window.location.href)
    if (url.origin !== window.location.origin) return null
    return url.pathname.startsWith(IMAGE_PREFIX) ? url.pathname : null
  } catch {
    return null
  }
}

/** 控えを `blob:` の URL にする。同じ画像なら作り直さない。 */
function toObjectUrl(path: string, blob: Blob): string {
  const known = objectUrls.get(path)
  if (known) {
    // 入れ直して新しい側へ回す（古く使ったものから手放すため）
    objectUrls.delete(path)
    objectUrls.set(path, known)
    return known
  }

  const url = URL.createObjectURL(blob)
  objectUrls.set(path, url)

  if (objectUrls.size > MAX_OBJECT_URLS) {
    const [oldest, oldestUrl] = objectUrls.entries().next().value!
    objectUrls.delete(oldest)
    URL.revokeObjectURL(oldestUrl)
  }

  return url
}

/**
 * 表示できた画像を控えておく。
 *
 * 取りに行くのは**表示できてから**。同じ URL をブラウザがすでに持っている
 * ので、ここでの取得は多くの場合それで済み、通信は増えない。
 */
async function remember(path: string): Promise<void> {
  if (failed.has(path)) return

  try {
    const response = await fetch(path)
    if (!response.ok) throw new Error(`画像を取り直せなかった (${response.status})`)
    await saveCachedImage(path, await response.blob())
  } catch {
    // 控えられなくても、表示そのものは今までどおりできる
    failed.add(path)
  }
}

/** 表示できたら控える。まだ読めていなければ、読めてから。 */
function rememberWhenLoaded(img: HTMLImageElement, path: string): void {
  if (img.complete && img.naturalWidth > 0) {
    void remember(path)
    return
  }
  img.addEventListener('load', () => void remember(path), { once: true })
}

/**
 * 1つの `<img>` を、控えがあれば差し替える。無ければ控えを作る。
 *
 * 差し替えは非同期（IndexedDB を引く）なので、その間は今までどおり
 * ネットワークからの読み込みが走る。届いたほうが先に出る。
 */
function apply(img: HTMLImageElement): void {
  if (img.hasAttribute(HANDLED_ATTRIBUTE)) return

  const path = imagePathOf(img)
  if (!path) return

  img.setAttribute(HANDLED_ATTRIBUTE, '')

  const known = objectUrls.get(path)
  if (known) {
    img.src = known
    return
  }

  void readCachedImage(path)
    .then((blob) => {
      if (!blob) {
        rememberWhenLoaded(img, path)
        return
      }
      // 差し替えの前に読み終わっていることもある。それでも同じ絵なので害はない
      img.src = toObjectUrl(path, blob)
    })
    .catch(() => {
      // IndexedDB が使えない環境（プライベートブラウズなど）では何もしない
    })
}

function applyAll(root: ParentNode): void {
  if (root instanceof HTMLImageElement) apply(root)
  for (const img of root.querySelectorAll('img')) apply(img)
}

/**
 * 画面に出てくる画像を見張る。起動時に1度だけ呼ぶ。
 *
 * 本文は打つたびに描き直される（行ごとに差し替わる）ので、`<img>` は
 * 何度も現れる。増えたところだけを見て差し替える。
 */
export function startCachedImages(): void {
  applyAll(document)

  const observer = new MutationObserver((records) => {
    for (const record of records) {
      if (record.type === 'attributes') {
        if (record.target instanceof HTMLImageElement) {
          // src が変わった＝別の画像。印を外して見直す
          record.target.removeAttribute(HANDLED_ATTRIBUTE)
          apply(record.target)
        }
        continue
      }

      for (const node of record.addedNodes) {
        if (node instanceof Element) applyAll(node)
      }
    }
  })

  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['src'],
  })
}
