const RANGES = [
  [0, 59],
  [0, 23],
  [1, 31],
  [1, 12],
  [0, 7],
] as const

function field(text: string, min: number, max: number): Set<number> | undefined {
  const values = new Set<number>()
  for (const part of text.split(',')) {
    const match = /^(\*|(\d+)(?:-(\d+))?)(?:\/(\d+))?$/.exec(part)
    if (!match) return undefined
    const from = match[1] === '*' ? min : Number(match[2])
    const to = match[1] === '*' ? max : Number(match[3] ?? (match[4] ? max : match[2]))
    const step = Number(match[4] ?? 1)
    if (from < min || to > max || from > to || step < 1) return undefined
    for (let v = from; v <= to; v += step) values.add(v)
  }

  return values
}

// ponytail: walks minute by minute for at most a year; fine for the 5 runs a view shows
export function nextRuns(schedule: string, from: number, count = 5): number[] {
  const parts = schedule.trim().split(/\s+/)
  if (parts.length !== 5) return []
  const sets = RANGES.map(([min, max], i) => field(parts[i] ?? '', min, max))
  if (sets.some(set => set === undefined)) return []
  type Sets = [Set<number>, Set<number>, Set<number>, Set<number>, Set<number>]
  const [minutes, hours, days, months, weekdays] = sets as Sets
  if (weekdays.has(7)) weekdays.add(0)
  const anyDay = parts[2] === '*'
  const anyWeekday = parts[4] === '*'
  const runs: number[] = []
  const t = new Date(from)
  t.setSeconds(0, 0)
  t.setMinutes(t.getMinutes() + 1)
  for (let i = 0; i < 527_040 && runs.length < count; i += 1) {
    const dayOk = days.has(t.getDate())
    const weekdayOk = weekdays.has(t.getDay())
    const dateOk = anyDay || anyWeekday ? dayOk && weekdayOk : dayOk || weekdayOk
    if (
      minutes.has(t.getMinutes()) &&
      hours.has(t.getHours()) &&
      months.has(t.getMonth() + 1) &&
      dateOk
    ) {
      runs.push(t.getTime())
    }
    t.setMinutes(t.getMinutes() + 1)
  }

  return runs
}
