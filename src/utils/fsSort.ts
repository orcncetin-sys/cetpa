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
