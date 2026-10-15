import type { TurnUsage } from 'claude-code'

import type { RabeMainUsage } from '../types'

// One step of the main session added to its model's counters. `usd` is the
// step's price at the 1-hour write rate, undefined for a model without one:
// the model's sum is then n/a for good.
export function addMain(
  main: Record<string, RabeMainUsage>,
  usage: TurnUsage,
  usd: number | undefined,
): Record<string, RabeMainUsage> {
  const was = main[usage.model]
  const isUnpriced = was?.isUnpriced || usd === undefined
  const next: RabeMainUsage = {
    steps: (was?.steps ?? 0) + 1,
    input:
      (was?.input ?? 0) +
      usage.input_tokens +
      usage.cache_creation_input_tokens +
      usage.cache_read_input_tokens,
    output: (was?.output ?? 0) + usage.output_tokens,
    cached: (was?.cached ?? 0) + usage.cache_read_input_tokens,
    ...(isUnpriced ? { isUnpriced: true as const } : { usd: (was?.usd ?? 0) + (usd ?? 0) }),
  }

  return { ...main, [usage.model]: next }
}
