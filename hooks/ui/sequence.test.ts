import { expect, test } from 'claude-code/testing'

import { DRAW_MS, reserve, SHOW_MS, screens, sequence } from './sequence'

test('queued focus work runs in order and continues after a failure', async () => {
  const seen: number[] = []
  let release!: () => void
  const gate = new Promise<void>(resolve => {
    release = resolve
  })
  const first = sequence(async () => {
    await gate
    seen.push(1)
    throw new Error('focus failed')
  })
  const second = sequence(async () => {
    seen.push(2)
  })
  release()
  await expect(first).rejects.toThrow('focus failed')
  await second
  expect(seen).toEqual([1, 2])
})

test('a reserved focus turn keeps later arrows behind the press that entered first', async () => {
  const seen: string[] = []
  const apply = reserve()
  const arrow = sequence(async () => {
    seen.push('arrow')
  })
  await apply(async () => {
    seen.push('press focus')
  })
  await arrow
  expect(seen).toEqual(['press focus', 'arrow'])
})

test('releasing a reserved focus turn lets arrows run while side effects wait', async () => {
  const seen: string[] = []
  const apply = reserve()
  await apply(async () => {
    seen.push('focus')
  })
  let finish!: () => void
  const sideEffect = new Promise<void>(resolve => {
    finish = resolve
  })
  const arrow = sequence(async () => {
    seen.push('arrow')
  })
  await arrow
  finish()
  await sideEffect
  expect(seen).toEqual(['focus', 'arrow'])
})

// A stand-in for `$.clock.sleep`: each sleep waits for the test to end it.
function sleeps() {
  const asked: { ms: number; signal: AbortSignal; end: (isRefused?: boolean) => void }[] = []
  const sleep = (ms: number, signal: AbortSignal) =>
    new Promise<void>((resolve, reject) => {
      signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true })
      asked.push({
        ms,
        signal,
        end: isRefused => (isRefused ? reject(new Error('refused')) : resolve()),
      })
    })
  return { asked, sleep }
}

const settled = async <T>(promise: Promise<T>) => {
  let value: T | 'pending' = 'pending'
  void promise.then(one => {
    value = one
  })
  for (let i = 0; i < 5; i++) await Promise.resolve()
  return value
}

test('a landing waits for a drawing that began after its ask, then the show time', async () => {
  const screen = screens()
  const { asked, sleep } = sleeps()
  const ready = screen.ask('terminal', sleep)
  expect(asked.map(one => one.ms)).toEqual([DRAW_MS])
  screen.drew('terminal', screen.asked() - 1)
  screen.drew('desktop', screen.asked())
  expect(await settled(ready)).toBe('pending')
  screen.drew('terminal', screen.asked())
  await settled(ready)
  expect(asked[0]?.signal.aborted).toBe(true)
  expect(asked.map(one => one.ms)).toEqual([DRAW_MS, SHOW_MS])
  expect(await settled(ready)).toBe('pending')
  asked[1]?.end()
  expect(await settled(ready)).toBe(true)
  expect(screen.pending()).toBe(0)
})

test('without a drawing, a refused sleep or after a release, a landing gives up', async () => {
  const screen = screens()
  const { asked, sleep } = sleeps()
  const late = [
    screen.ask('terminal', sleep),
    screen.ask('terminal', sleep),
    screen.ask('terminal', sleep),
  ]
  for (const one of asked) one.end()
  expect(await Promise.all(late)).toEqual([false, false, false])
  expect(screen.pending()).toBe(0)

  const refused = screen.ask('terminal', sleep)
  asked.at(-1)?.end(true)
  expect(await refused).toBe(false)

  const shown = screen.ask('terminal', sleep)
  screen.drew('terminal', screen.asked())
  await settled(shown)
  asked.at(-1)?.end(true)
  expect(await shown).toBe(false)

  const moved = [screen.ask('terminal', sleep), screen.ask('desktop', sleep)]
  screen.drew('desktop', screen.asked())
  await settled(moved[1] as Promise<boolean>)
  screen.release()
  expect(await Promise.all(moved)).toEqual([false, false])
  expect(screen.pending()).toBe(0)
})
