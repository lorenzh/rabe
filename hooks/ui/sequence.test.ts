import { expect, test } from 'claude-code/testing'

import { DRAW_MS, inTurn, reserve, SHOW_MS, screens, sequence, slots } from './sequence'

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

test('runs of one key wait for the earlier ones, even a failed one; other keys do not wait', async () => {
  const seen: string[] = []
  let release!: () => void
  const gate = new Promise<void>(resolve => {
    release = resolve
  })
  const first = inTurn('message:a', async () => {
    await gate
    seen.push('a1')
    throw new Error('released')
  })
  const second = inTurn('message:a', async () => {
    seen.push('a2')
  })
  await inTurn('search', async () => {
    seen.push('search')
  })
  expect(seen).toEqual(['search'])
  release()
  await expect(first).rejects.toThrow('released')
  await second
  expect(seen).toEqual(['search', 'a1', 'a2'])
})

// GPT review of 42f1a46: the engine queues a field's Input events before
// Rabe's hook, so the kit cannot overlap them. Here two events of one field
// reach the hook while the first is held beneath, before its closure ran; each
// closure fills the oldest empty slot of its key, as `leave` in pane.tsx does.
test('overlapping events of one key each keep their own action only when they take turns', async () => {
  const overlap = async (isInTurn: boolean) => {
    const table = slots<string>()
    const key = 'terminal message:a'
    const entered: string[] = []
    let release!: () => void
    const gate = new Promise<void>(resolve => {
      release = resolve
    })
    // The hook: a new slot per event, then the chain beneath runs the closure.
    const hook = (event: string, beneath: () => Promise<void>) => {
      entered.push(event)
      const run = () =>
        table.enter(key, async mine => {
          await beneath()
          table.leave(key, `${event}'s action`)
          return mine.press
        })
      return isInTurn ? inTurn(key, run) : run()
    }
    const first = hook('first', () => gate)
    const second = hook('second', async () => undefined)
    for (let i = 0; i < 5; i++) await Promise.resolve()
    const enteredWhileHeld = [...entered]
    release()
    return { enteredWhileHeld, actions: await Promise.all([first, second]) }
  }

  const taking = await overlap(true)
  expect(taking.enteredWhileHeld).toEqual(['first', 'second'])
  expect(taking.actions).toEqual(["first's action", "second's action"])
  // Without turns the second closure fills the held first event's slot and
  // the second event carries out nothing.
  const racing = await overlap(false)
  expect(racing.enteredWhileHeld).toEqual(['first', 'second'])
  expect(racing.actions).toEqual(["second's action", undefined])
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
