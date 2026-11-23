import { describe, expect, it } from 'vitest'
import { musicxmlName } from './saveScore'

describe('musicxmlName', () => {
  it('keeps the name and swaps the extension', () => {
    expect(musicxmlName('BWV_0851a.pdf', null)).toBe('BWV_0851a.musicxml')
    expect(musicxmlName('take 3.m4a', null)).toBe('take 3.musicxml')
    expect(musicxmlName(null, 'Minuetto: in Sol')).toBe('Minuetto- in Sol.musicxml')
    expect(musicxmlName(null, null)).toBe('spartito.musicxml')
  })
})
