/**
 * 左のサイドバー（RTM の左袖に合わせる）の開閉。
 *
 * どこからでも同じ状態を読めるよう useState に置く。app.vue が本文を
 * 右へ寄せる幅の計算に使い、AppSidebar が中身を描く。
 *
 * 開いているかどうかは**端末ごとの見え方**なので、サーバーには置かず
 * localStorage に控える（一覧の並びのような、どの端末でも揃えたい設定
 * とは別扱い。docs/15-client-state.md 14.7）。狭い画面では本文を覆って
 * しまう以上、広い画面で開いたことを電話にまで持ち込む理由がない。
 */

/** 折りたためる区分。 */
export type SidebarSection = 'diary' | 'lists' | 'tags'

const STORAGE_KEY = 'datalake:sidebar'

/**
 * 本文の横に並べて置ける幅か。
 *
 * これより狭ければ、開いたときは本文に**重ねて**出し、背景を押せば閉じる。
 * 一覧と詳細を並べる境目（useSplitLayout）と同じにする。左袖・一覧・詳細を
 * 同時に置けるのはこの幅からで、境目を分けると中途半端な幅で袖だけが
 * 残ってしまう。
 */
const DOCK_QUERY = '(min-width: 60rem)'

interface SidebarState {
  open: boolean
  collapsed: SidebarSection[]
}

/**
 * 控えを読んだか。
 *
 * useSidebar() は app.vue と AppSidebar の両方から呼ばれる。読み直すと、
 * 一度閉じたサイドバーが「広い画面の既定（開く）」で開き直ってしまう。
 */
let restored = false

function read(): SidebarState | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    return JSON.parse(raw) as SidebarState
  } catch {
    // 読めない環境（プライベートブラウズなど）では、画面の広さで決める
    return null
  }
}

export function useSidebar() {
  /*
   * サーバー描画では閉じた状態で出す。控えも画面の広さもブラウザにしか
   * 無いため、ここで開いた状態を描くとハイドレーションで食い違う。
   */
  const open = useState<boolean>('sidebar:open', () => false)
  const collapsed = useState<SidebarSection[]>('sidebar:collapsed', () => [])

  /*
   * 端からのスワイプで引き出している最中の、指を動かした距離（px）。
   * 触れていなければ null。useSidebarSwipe が入れ、AppSidebar が
   * 袖の位置と背景の濃さに使う。
   *
   * 開いているかどうか（open）とは別に持つ。途中でやめれば閉じたところへ
   * 戻るので、引いている間はまだ「開いた」ことにはならない。
   */
  const dragX = useState<number | null>('sidebar:drag', () => null)

  const docked = useMediaQuery(DOCK_QUERY)

  onMounted(() => {
    if (restored) return
    restored = true

    const saved = read()
    if (saved) {
      open.value = saved.open
      collapsed.value = saved.collapsed ?? []
      return
    }
    // 初めて開いたとき。並べて置ける幅なら出しておく（RTM と同じ見え方）
    open.value = window.matchMedia(DOCK_QUERY).matches
  })

  function remember() {
    try {
      const state: SidebarState = { open: open.value, collapsed: collapsed.value }
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
    } catch {
      // 書けなくても、その回の見え方は変わらない
    }
  }

  function setOpen(next: boolean) {
    open.value = next
    remember()
  }

  function toggle() {
    setOpen(!open.value)
  }

  function close() {
    if (!open.value) return
    setOpen(false)
  }

  function isCollapsed(section: SidebarSection): boolean {
    return collapsed.value.includes(section)
  }

  /** 区分（日記・リスト・タグ）の折りたたみ。中身が長いタグ向け。 */
  function toggleSection(section: SidebarSection) {
    collapsed.value = isCollapsed(section)
      ? collapsed.value.filter((name) => name !== section)
      : [...collapsed.value, section]
    remember()
  }

  return { open, docked, dragX, setOpen, toggle, close, isCollapsed, toggleSection }
}
