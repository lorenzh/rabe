let tail = Promise.resolve()

export function sequence<T>(run: () => Promise<T>): Promise<T> {
  const result = tail.then(run, run)
  tail = result.then(
    () => undefined,
    () => undefined,
  )
  return result
}
