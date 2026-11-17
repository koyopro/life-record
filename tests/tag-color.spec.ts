import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  LEGACY_TAG_COLORS,
  PICKER_TAG_COLORS,
  RTM_TAG_COLORS,
  rtmTagColorFromHex,
  TAG_COLOR_SWATCHES,
  TAG_COLORS,
} from '~~/shared/types/tag'

/**
 * タグの色見本は shared/types/tag.ts（型・import 用）と main.css（表示用）の
 * 2 か所に書いてある。CSS からは TS を読めないので、片方だけ直したときに
 * 気づけるようここで突き合わせる。
 */
const css = readFileSync(resolve('app/assets/css/main.css'), 'utf8')

/** `--tag-red: ...;` のような宣言から値を取り出す。 */
function cssVar(name: string): string | null {
  const match = css.match(new RegExp(`^\\s*--${name}:\\s*(.+?);`, 'm'))
  return match ? match[1]!.trim() : null
}

/** WCAG のコントラスト比。 */
function contrast(a: string, b: string): number {
  const luminance = (hex: string) => {
    const [r, g, b] = [1, 3, 5].map((i) => {
      const c = parseInt(hex.slice(i, i + 2), 16) / 255
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
    })
    return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!
  }
  const [dark, light] = [luminance(a), luminance(b)].sort((x, y) => x - y)
  return (light! + 0.05) / (dark! + 0.05)
}

describe('タグの色見本', () => {
  it('色ごとに背景と文字色の CSS 変数がある', () => {
    for (const color of [...TAG_COLORS, 'default']) {
      expect(cssVar(`tag-${color}`), `--tag-${color}`).not.toBeNull()
      expect(cssVar(`tag-${color}-fg`), `--tag-${color}-fg`).not.toBeNull()
    }
  })

  it('RTM の 24 色は CSS でも同じ 16 進の値を使う', () => {
    for (const color of RTM_TAG_COLORS) {
      const swatch = TAG_COLOR_SWATCHES[color]
      expect(cssVar(`tag-${color}`), color).toBe(swatch.background)
      expect(cssVar(`tag-${color}-fg`), `${color} の文字色`).toBe(swatch.foreground)
    }
  })

  it('RTM の 24 色は淡い側と濃い側が対になっている', () => {
    for (const color of RTM_TAG_COLORS) {
      const swatch = TAG_COLOR_SWATCHES[color]
      const pair = color.endsWith('-pale')
        ? color.slice(0, -'-pale'.length)
        : `${color}-pale`
      expect(RTM_TAG_COLORS).toContain(pair)
      // 対の相手の背景色が、そのまま自分の文字色になる
      expect(TAG_COLOR_SWATCHES[pair as (typeof RTM_TAG_COLORS)[number]].background).toBe(
        swatch.foreground,
      )
    }
  })

  it('色見本に出す独自の色は、明暗で値を変えず、文字が読める濃さの組にする', () => {
    for (const color of PICKER_TAG_COLORS.filter((c) => (LEGACY_TAG_COLORS as readonly string[]).includes(c))) {
      const swatch = TAG_COLOR_SWATCHES[color]
      expect(cssVar(`tag-${color}`), color).toBe(swatch.background)
      expect(cssVar(`tag-${color}-fg`), `${color} の文字色`).toBe(swatch.foreground)
      // WCAG の AA（4.5）を満たす
      expect(contrast(swatch.background, swatch.foreground), color).toBeGreaterThanOrEqual(4.5)
    }
  })

  it('色見本に出さない独自の色は、白文字で読ませる前提のまま', () => {
    for (const color of LEGACY_TAG_COLORS.filter((c) => !(PICKER_TAG_COLORS as readonly string[]).includes(c))) {
      expect(TAG_COLOR_SWATCHES[color].foreground).toBe('#ffffff')
    }
  })

  it('RTM の背景色から色見本を丸めずに引ける', () => {
    // RTM のエクスポートに出てくる値（大文字表記）をそのまま渡せる
    expect(rtmTagColorFromHex('#5229A3')).toBe('rtm-purple')
    expect(rtmTagColorFromHex('#E0D5F9')).toBe('rtm-purple-pale')
    expect(rtmTagColorFromHex('#FFFFD4')).toBe('rtm-olive-pale')
    expect(rtmTagColorFromHex('#006633')).toBe('rtm-forest')
    expect(rtmTagColorFromHex('#123456')).toBeNull()
  })
})
