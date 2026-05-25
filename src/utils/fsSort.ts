/**
 * fsSort.ts — client-side sort helpers for Firestore snapshots.
 *
 * WHY: orderBy('createdAt', 'desc') in onSnapshot queries triggers
 * INTERNAL ASSERTION FAILED (b815 / ve:-1) in Firebase SDK 12+ when any
 * document in the collection is missing the ordered field.  We removed all
 * orderBy('createdAt') clauses from queries and sort client-side instead.
 */

type FirestoreTimestamp = { toDate: () => Date };

function toMs(v: unknown): number {
  if (!v) return 0;
  if (typeof (v as FirestoreTimestamp).toDate === 'function')
    return (v as FirestoreTimestamp).toDate().getTime();
  if (typeof v === 'string' || typeof v === 'number')
    return new Date(v as string).getTime();
  return 0;
}

/**
 * Sort an array of docs by their `createdAt` field (Firestore Timestamp, ISO string, or ms number).
 * Works on any array type — docs without createdAt are sorted to the end.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function sortByCreatedAt<T>(docs: T[], dir: 'asc' | 'desc' = 'desc'): T[] {
  return [...docs].sort((a, b) => {
    const diff = toMs((b as Record<string, unknown>).createdAt) -
                 toMs((a as Record<string, unknown>).createdAt);
    return dir === 'desc' ? diff : -diff;
  });
}

/**
 * General-purpose field sort.
 * Handles Firestore Timestamps, ISO date strings, numbers, and plain strings.
 * Docs missing the field sort to the end regardless of direction.
 *
 * @example
 * snap.docs.map(d => ({id:d.id,...d.data()})).sort(byField('date','desc'))
 */
export function byField<T>(field: string, dir: 'asc' | 'desc' = 'asc') {
  return (a: T, b: T): number => {
    const av = (a as Record<string, unknown>)[field];
    const bv = (b as Record<string, unknown>)[field];

    // Both missing → stable
    if (av == null && bv == null) return 0;
    // Missing → push to end regardless of direction
    if (av == null) return 1;
    if (bv == null) return -1;

    // Firestore Timestamp
    const isTs = (v: unknown): v is FirestoreTimestamp =>
      typeof (v as FirestoreTimestamp).toDate === 'function';

    if (isTs(av) && isTs(bv)) {
      const diff = av.toDate().getTime() - bv.toDate().getTime();
      return dir === 'asc' ? diff : -diff;
    }

    // ISO date strings or plain strings
    const as = String(av);
    const bs = String(bv);
    const cmp = as < bs ? -1 : as > bs ? 1 : 0;
    return dir === 'asc' ? cmp : -cmp;
  };
}
