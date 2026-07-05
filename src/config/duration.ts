const UNIT_MS: Record<string, number> = { s: 1_000, m: 60_000, h: 3_600_000 };

export function parseDurationMs(value: string): number {
  const match = /^(\d+)(s|m|h)$/.exec(value);
  if (!match) throw new Error(`Invalid duration: ${value}`);
  const amount = Number(match[1]);
  const unit = match[2] as keyof typeof UNIT_MS;
  // Safe: the regex capture group only ever matches 's' | 'm' | 'h', all present in UNIT_MS.
  return amount * UNIT_MS[unit]!;
}
