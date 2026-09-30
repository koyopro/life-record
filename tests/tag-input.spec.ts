import { describe, expect, it } from 'vitest'
import { splitTagInput } from '../shared/types/tag'

describe('splitTagInput', () => {
  it('打っている語だけを切り出す', () => {
    expect(splitTagInput('添削')).toEqual({ committed: [], fragment: '添削' })
  })

  it('2つめ以降の語でも、最後の語だけを切り出す', () => {
    expect(splitTagInput('対局 添削')).toEqual({ committed: ['対局'], fragment: '添削' })
    expect(splitTagInput('対局,添削')).toEqual({ committed: ['対局'], fragment: '添削' })
  })

  it('末尾が区切りなら打っている語は空', () => {
    expect(splitTagInput('対局 ')).toEqual({ committed: ['対局'], fragment: '' })
    expect(splitTagInput('')).toEqual({ committed: [], fragment: '' })
  })

  it('# 付きの語はそのまま残す（候補側で外す）', () => {
    expect(splitTagInput('a #添')).toEqual({ committed: ['a'], fragment: '#添' })
  })
})
