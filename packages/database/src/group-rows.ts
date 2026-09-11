/** Group a set-based read once; callers never query or rescan it per parent. */
export function groupRowsBy<T>(
  rows: readonly T[],
  key: (row: T) => string,
): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const row of rows) {
    const id = key(row);
    const group = groups.get(id);
    if (group === undefined) groups.set(id, [row]);
    else group.push(row);
  }
  return groups;
}
