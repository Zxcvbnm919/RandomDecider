export type Rng = () => number

/** 53 位系统随机数，返回 [0, 1)。 */
export function systemRng(): number {
  const c = globalThis.crypto
  const buffer = new Uint32Array(2)
  if (c && typeof c.getRandomValues === 'function') c.getRandomValues(buffer)
  else {
    buffer[0] = Math.floor(Math.random() * 0x1_0000_0000)
    buffer[1] = Math.floor(Math.random() * 0x1_0000_0000)
  }
  // 27 位 + 26 位 = 53 位有效随机数，保证结果严格落在 [0, 1)。
  const hi = buffer[0]! >>> 5
  const lo = buffer[1]! >>> 6
  return (hi * 67_108_864 + lo) / 9_007_199_254_740_992
}

export function randomInt(maxExclusive: number, rng: Rng = systemRng): number {
  if (maxExclusive <= 0) throw new Error('maxExclusive must be > 0')
  return Math.min(maxExclusive - 1, Math.floor(rng() * maxExclusive))
}

export function pickWeighted<T>(
  entries: { item: T; weight: number }[],
  rng: Rng = systemRng,
): T {
  const total = entries.reduce((sum, entry) => sum + Math.max(0, entry.weight), 0)
  if (total <= 0) throw new Error('no positive weight')
  const target = rng() * total
  let acc = 0
  for (const entry of entries) {
    const weight = Math.max(0, entry.weight)
    if (weight <= 0) continue
    acc += weight
    if (target < acc) return entry.item
  }
  const last = entries[entries.length - 1]
  if (!last) throw new Error('empty entries')
  return last.item
}
