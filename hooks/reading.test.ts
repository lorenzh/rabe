import { expect, test } from 'claude-code/testing'

import {
  byteLength,
  cursorOf,
  fileOffset,
  inodeOf,
  jsonRecords,
  list,
  num,
  outputLines,
  parseJson,
  readChunk,
  readPlan,
  rec,
  str,
} from './reading'

const stat = { size: 6, mtimeMs: 1, identity: '1' }
const held = { ...stat, offset: 6, partial: false }

test('a cursor skips unchanged files and resets for truncation, rewrite or replacement', () => {
  expect(fileOffset(stat, held)).toBeUndefined()
  expect(fileOffset({ ...stat, size: 9 }, held)).toBe(6)
  expect(fileOffset({ ...stat, size: 2 }, held)).toBe(0)
  expect(fileOffset({ ...stat, mtimeMs: 2 }, held)).toBe(0)
  expect(fileOffset({ ...stat, size: 9, identity: '2' }, held)).toBe(0)
})

test('byte offsets count UTF-8 and leave partial records for the next read', () => {
  expect(byteLength('aé界😀')).toBe(10)
  expect(readChunk('é\n{"x":', false, true)).toEqual({ text: 'é\n', bytes: 3, partial: true })
  expect(readChunk('{"x":1}', false, true)).toEqual({ text: '{"x":1}', bytes: 7, partial: false })
  expect(readChunk('abc\ncut', true, false)).toEqual({ text: 'abc\n', bytes: 4, partial: false })
})

test('output chunks keep the unfinished line time and reset after replacement', () => {
  const held = {
    seen: 2,
    lines: [
      { at: 1, text: 'ready' },
      { at: 2, text: 'par' },
    ],
  }
  expect(outputLines(held, ['partial', 'new'], 3, false, true)).toEqual({
    seen: 3,
    lines: [
      { at: 1, text: 'ready' },
      { at: 2, text: 'partial' },
      { at: 3, text: 'new' },
    ],
  })
  expect(outputLines(held, ['fresh'], 3, true, false)).toEqual({
    seen: 1,
    lines: [{ at: 3, text: 'fresh' }],
  })
})

test('an oversized record is skipped until its newline without stopping the cursor', () => {
  expect(readChunk('too large', true, true)).toEqual({
    text: '',
    bytes: 9,
    partial: false,
    isDiscarding: true,
  })
  expect(readChunk('rest\n{"x":1}\n', false, true, true)).toEqual({
    text: '{"x":1}\n',
    bytes: 13,
    partial: false,
  })
})

test('an exit chunk removes the separator left by the preceding output chunk', () => {
  const held = {
    seen: 2,
    lines: [
      { at: 1, text: 'ready' },
      { at: 1, text: '' },
    ],
  }
  expect(outputLines(held, [], 2, false, false, true)).toEqual({
    seen: 1,
    lines: [{ at: 1, text: 'ready' }],
  })
})

test('read plans use whole small files and byte tails for appends or large resets', () => {
  expect(inodeOf('  123 file\n')).toBe('123')
  expect(inodeOf('unavailable')).toBeUndefined()
  expect(readPlan(stat, undefined, 8)).toEqual({ offset: 0, reset: true, whole: true })
  expect(readPlan({ ...stat, size: 9 }, held, 8)).toEqual({ offset: 6, reset: false, whole: false })
  expect(readPlan({ ...stat, size: 9 }, undefined, 8)).toEqual({
    offset: 0,
    reset: true,
    whole: false,
  })
  expect(readPlan(stat, held, 8)).toBeUndefined()
})

test('restored cursors reject fractional byte positions and invalid fields', () => {
  for (const value of [
    null,
    [],
    { ...held, offset: 0.5 },
    { ...held, size: 6.5 },
    { ...held, offset: Infinity },
    { ...held, identity: 42 },
    { ...held, partial: 'false' },
  ]) {
    expect(cursorOf(value)).toBeUndefined()
  }
  expect(cursorOf(held)).toBe(held)
})

test('JSON helpers keep objects and drop everything else', () => {
  expect(parseJson('{"a":1}')).toEqual({ a: 1 })
  expect(parseJson('[1]')).toBeUndefined()
  expect(parseJson('3')).toBeUndefined()
  expect(parseJson('not json')).toBeUndefined()
  expect(jsonRecords('{"a":1}\n\nbad\n[2]\n{"b":2}')).toEqual([{ a: 1 }, { b: 2 }])
  expect(rec([1])).toEqual({})
  expect(rec({ a: 1 })).toEqual({ a: 1 })
  expect(list('x')).toEqual([])
  expect(str('')).toBeUndefined()
  expect(str('a')).toBe('a')
  expect(num('1')).toBeUndefined()
  expect(num(1)).toBe(1)
})
