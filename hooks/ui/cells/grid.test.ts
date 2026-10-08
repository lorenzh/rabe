import { expect, test } from 'claude-code/testing'

import {
  bar,
  box,
  cell,
  decode,
  encode,
  fill,
  fit,
  grid,
  hline,
  lines,
  paste,
  safe,
  vline,
  write,
} from './grid'
import { DEFAULT } from './palette'

test('a new grid holds spaces in the terminal default colors', () => {
  const g = grid(3, 2)
  expect(lines(g)).toEqual(['', ''])
  expect(cell(g, 2, 1)).toEqual([32, DEFAULT, DEFAULT])
})

test('write puts text at a position, clips at the edge and returns the next column', () => {
  const g = grid(6, 2)
  expect(write(g, 1, 0, 'abc', { fg: 0xff0000 })).toBe(4)
  expect(write(g, 4, 1, 'xyz')).toBe(7)
  expect(write(g, 0, 5, 'gone')).toBe(4)
  expect(lines(g)).toEqual([' abc', '    xy'])
  expect(cell(g, 1, 0)).toEqual([97, 0xff0000, DEFAULT])
})

test('write keeps the background a style leaves out', () => {
  const g = grid(2, 1, { bg: 0x112233 })
  write(g, 0, 0, 'a', { fg: 0x445566 })
  expect(cell(g, 0, 0)).toEqual([97, 0x445566, 0x112233])
})

test('safe keeps width-1 BMP characters and replaces the rest', () => {
  expect(safe('ok ◐ ▶ ✗ ◉ ⟳ ─│█')).toBe('ok ◐ ▶ ✗ ◉ ⟳ ─│█')
  expect(safe('a\tb\nc')).toBe('a b c')
  expect(safe('🚀 done')).toBe('? done')
  expect(safe('日本')).toBe('??')
  expect(safe('é')).toBe('e?')
  expect(safe('✅ ok')).toBe('? ok')
})

test('fit pads short text and cuts long text with an ellipsis', () => {
  expect(fit('abc', 5)).toBe('abc  ')
  expect(fit('abcdef', 4)).toBe('abc…')
  expect(fit('abc', 0)).toBe('')
  expect(fit('🚀ab', 3)).toBe('?ab')
})

test('fill colors a rectangle and stays inside the grid', () => {
  const g = grid(4, 3)
  fill(g, 2, 1, 5, 5, { bg: 0x010203 }, '.')
  expect(lines(g)).toEqual(['', '  ..', '  ..'])
  expect(cell(g, 3, 2)).toEqual([46, DEFAULT, 0x010203])
})

test('box, hline and vline draw box lines', () => {
  const g = grid(5, 4)
  box(g, 0, 0, 5, 4)
  expect(lines(g)).toEqual(['┌───┐', '│   │', '│   │', '└───┘'])
  const h = grid(4, 3)
  hline(h, 0, 1, 4)
  vline(h, 1, 0, 3)
  expect(lines(h)).toEqual([' │', '─│──', ' │'])
})

test('bar fills a width in eighths of a block', () => {
  expect(bar(1, 1, 4)).toBe('████')
  expect(bar(0, 1, 4)).toBe('    ')
  expect(bar(1, 2, 4)).toBe('██  ')
  expect(bar(1, 16, 2)).toBe('▏ ')
  expect(bar(5, 0, 3)).toBe('   ')
})

test('paste copies one grid into another and clips it', () => {
  const g = grid(4, 2)
  const small = grid(3, 1)
  write(small, 0, 0, 'xyz', { fg: 0x0000ff })
  paste(g, small, 2, 1)
  expect(lines(g)).toEqual(['', '  xy'])
  expect(cell(g, 2, 1)).toEqual([120, 0x0000ff, DEFAULT])
})

test('encode gives little-endian u32 triplets in padded base64', () => {
  const g = grid(1, 1)
  write(g, 0, 0, '█', { fg: 0xff8800 })
  expect(encode(g)).toBe('iCUAAACI/wAAAAAB')
  const two = grid(2, 1)
  write(two, 0, 0, 'A', { fg: 1, bg: 2 })
  write(two, 1, 0, 'B', { fg: 3, bg: 4 })
  expect(encode(two)).toBe('QQAAAAEAAAACAAAAQgAAAAMAAAAEAAAA')
  expect(decode(2, 1, encode(two))).toEqual(two)
})
