let tail = Promise.resolve()

export function reserve(): <T>(run: () => Promise<T>) => Promise<T> {
  const previous = tail
  let release!: () => void
  const turn = new Promise<void>(resolve => {
    release = resolve
  })
  tail = previous.then(
    () => turn,
    () => turn,
  )

  return async run => {
    try {
      await previous
      return await run()
    } finally {
      release()
    }
  }
}

export function sequence<T>(run: () => Promise<T>): Promise<T> {
  const result = tail.then(run, run)
  tail = result.then(
    () => undefined,
    () => undefined,
  )
  return result
}

// The last run per key, which the next run of that key waits for.
const lanes = new Map<string, Promise<void>>()

// Runs `run` once every earlier run of the same key settled; other keys do
// not wait.
export function inTurn<T>(key: string, run: () => Promise<T>): Promise<T> {
  const result = (lanes.get(key) ?? Promise.resolve()).then(run)
  const done = result.then(
    () => undefined,
    () => undefined,
  )
  lanes.set(key, done)
  void done.then(() => {
    if (lanes.get(key) === done) lanes.delete(key)
  })
  return result
}

export type Slot<P> = { press?: P }

// The events under way per key, oldest first. `enter` runs an event with its
// own new slot and drops the slot when the run settles; `leave` fills the
// oldest empty slot of a key (the closure beneath does not know its event).
export function slots<P>() {
  const waiting = new Map<string, Slot<P>[]>()
  return {
    async enter<R>(key: string, run: (mine: Slot<P>) => Promise<R>): Promise<R> {
      const mine: Slot<P> = {}
      waiting.set(key, [...(waiting.get(key) ?? []), mine])
      try {
        return await run(mine)
      } finally {
        const rest = (waiting.get(key) ?? []).filter(one => one !== mine)
        if (rest.length > 0) waiting.set(key, rest)
        else waiting.delete(key)
      }
    },
    leave(key: string, press: P): void {
      const slot = waiting.get(key)?.find(one => !one.press)
      if (slot) slot.press = press
    },
  }
}

// How long a landing waits for a drawing of the new view, and how long after
// it before the focus call (a drawing reaches the screen some time after the
// render hook returns: docs/feasibility/ui.md, item 9). Timing, not a barrier.
export const DRAW_MS = 300
export const SHOW_MS = 100

export type Sleep = (ms: number, signal: AbortSignal) => Promise<void>

type Wait = { surface: string; after: number; stop: AbortController; drawn: () => void }

// The landings that wait for a drawing: `ask` counts the asks, and `drew`
// reports a drawing on `surface` that began after ask `ask`. A wait resolves
// true after such a drawing and SHOW_MS, and false when DRAW_MS pass without
// one, a sleep is refused or `release` ends every wait.
export function screens() {
  let asked = 0
  let waits: Wait[] = []
  return {
    asked: () => asked,
    pending: () => waits.length,
    drew(surface: string, ask: number): void {
      for (const one of waits) if (one.surface === surface && one.after <= ask) one.drawn()
    },
    release(): void {
      for (const one of waits) one.stop.abort()
    },
    async ask(surface: string, sleep: Sleep): Promise<boolean> {
      const stop = new AbortController()
      const timer = new AbortController()
      stop.signal.addEventListener('abort', () => timer.abort(), { once: true })
      let drawn: () => void = () => undefined
      const wait: Wait = { surface, after: ++asked, stop, drawn: () => drawn() }
      waits.push(wait)
      try {
        const isDrawn = await new Promise<boolean>(go => {
          drawn = () => go(true)
          stop.signal.addEventListener('abort', () => go(false), { once: true })
          sleep(DRAW_MS, timer.signal).then(
            () => go(false),
            () => go(false),
          )
        })
        timer.abort()
        if (!isDrawn) return false
        await sleep(SHOW_MS, stop.signal)
        return true
      } catch {
        return false
      } finally {
        waits = waits.filter(one => one !== wait)
      }
    },
  }
}
