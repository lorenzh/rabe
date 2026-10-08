const pad = (n: number) => String(n).padStart(2, '0')

export function duration(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000))
  if (s < 60) return `${s}s`
  if (s < 3600) return `${Math.floor(s / 60)}m${pad(s % 60)}s`

  return `${Math.floor(s / 3600)}h${pad(Math.floor(s / 60) % 60)}m`
}

export function short(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000))
  if (s < 60) return `${s}s`
  if (s < 3600) return `${Math.floor(s / 60)}m`

  return duration(ms)
}

export function ago(ms: number): string {
  const s = Math.floor(ms / 1000)
  if (s < 10) return 'just now'
  if (s < 3600) return `${short(ms)} ago`

  return `${Math.floor(s / 3600)}h ago`
}

export function countdown(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000))
  const h = Math.floor(s / 3600)
  const m = Math.floor(s / 60) % 60

  return h > 0 ? `${h}:${pad(m)}:${pad(s % 60)}` : `${m}:${pad(s % 60)}`
}

export function clockTime(ms: number): string {
  const d = new Date(ms)

  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

export function tokens(n: number): string {
  if (n < 1000) return String(n)
  if (n < 1_000_000) return `${Math.round(n / 1000)}k`

  return `${(n / 1_000_000).toFixed(1)}M`
}

export function usd(n: number): string {
  return `$${n.toFixed(2)}`
}
