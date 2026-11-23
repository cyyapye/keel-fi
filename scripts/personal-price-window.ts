const dayMs = 86_400_000;
// 10:00 UTC is after the previous US trading date, including on DST transitions.
export function dailyWindow(now: number) {
  const start =
    Math.floor((now - 10 * 3_600_000) / dayMs) * dayMs + 10 * 3_600_000;
  return {
    day: new Date(now).toISOString().slice(0, 10),
    next: start + dayMs,
  };
}
