import { describe, expect, it } from 'vitest'
import { createSavedVersions } from '~/utils/saved-versions'

/**
 * 保存より前に出した取得の応答が、保存の後で届いたときに退ける
 * （docs/15-client-state.md 14.2 の 4）。
 */
describe('保存できた版の控え', () => {
  it('何も保存していなければ、サーバーの内容をそのまま採る', () => {
    const versions = createSavedVersions()

    expect(versions.isStale('a', '2026-08-22T10:00:00.000Z')).toBe(false)
    expect(versions.isStale('a', null)).toBe(false)
  })

  it('保存より古い内容は退ける', () => {
    const versions = createSavedVersions()
    versions.mark('a', '2026-08-22T10:00:05.000Z')

    expect(versions.isStale('a', '2026-08-22T10:00:00.000Z')).toBe(true)
  })

  it('保存と同じ時刻・より新しい内容は採る（こちらの保存が入っている）', () => {
    const versions = createSavedVersions()
    versions.mark('a', '2026-08-22T10:00:05.000Z')

    expect(versions.isStale('a', '2026-08-22T10:00:05.000Z')).toBe(false)
    expect(versions.isStale('a', '2026-08-22T10:00:06.000Z')).toBe(false)
  })

  it('鍵が違えば影響しない', () => {
    const versions = createSavedVersions()
    versions.mark('a', '2026-08-22T10:00:05.000Z')

    expect(versions.isStale('b', '2026-08-22T10:00:00.000Z')).toBe(false)
  })

  it('保存したのにサーバーに記録が無ければ、届いた内容の方が古いとみなす', () => {
    const versions = createSavedVersions()
    versions.mark('a', '2026-08-22T10:00:05.000Z')

    expect(versions.isStale('a', null)).toBe(true)
  })

  it('応答が前後して届いても、いちばん新しい保存を覚えておく', () => {
    const versions = createSavedVersions()
    versions.mark('a', '2026-08-22T10:00:05.000Z')
    versions.mark('a', '2026-08-22T10:00:01.000Z')

    expect(versions.isStale('a', '2026-08-22T10:00:03.000Z')).toBe(true)
  })

  it('更新日時が分からない応答は控えない', () => {
    const versions = createSavedVersions()
    versions.mark('a', null)
    versions.mark('a', 'これは日時ではない')

    expect(versions.isStale('a', '2026-08-22T10:00:00.000Z')).toBe(false)
  })

  it('捨てた鍵は元に戻る', () => {
    const versions = createSavedVersions()
    versions.mark('a', '2026-08-22T10:00:05.000Z')
    versions.forget('a')

    expect(versions.isStale('a', '2026-08-22T10:00:00.000Z')).toBe(false)
  })
})
