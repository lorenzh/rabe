import type { RabeItem } from './model'
import { type Change, capEnded } from './registry'

export type Poller = {
  run: (items: RabeItem[]) => Promise<Change | undefined>
  every?: number
  initial?: boolean
  due?: number
}
export type Pollers = Poller[]

export function delayOf(idle: number, isRunning: boolean, isChanged: boolean) {
  const quiet = isRunning || isChanged ? 0 : idle + 1
  return { idle: quiet, delay: quiet < 5 ? 2000 : 10000 }
}

export function nextStep(now: number, due: number, isRunning: boolean) {
  if (now >= due || (isRunning && due - now > 2000)) return 'poll'
  return isRunning ? 'redraw' : 'skip'
}

export function pollDue(
  poll: Pick<Poller, 'every' | 'due' | 'initial'>,
  now: number,
  initial = false,
) {
  return (!initial || poll.initial !== false) && now >= (poll.due ?? 0)
}

export async function collect(
  pollers: Pollers,
  items: RabeItem[],
  now: number,
  initial = false,
): Promise<{ change: Change; items: RabeItem[] }> {
  const changes: Change[] = []
  for (const poll of pollers) {
    if (!pollDue(poll, now, initial)) continue
    try {
      const change = await poll.run(items)
      if (change) {
        changes.push(change)
        items = capEnded(change(items))
      }
    } catch {}
    poll.due = now + (poll.every ?? 0)
  }
  return { change: held => changes.reduce((list, change) => capEnded(change(list)), held), items }
}
