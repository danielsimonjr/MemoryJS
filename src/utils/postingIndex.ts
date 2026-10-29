/**
 * Deletes `id` from each posting set named by `terms`, and drops empty sets.
 * A missing `terms` iterable returns without writing. The forward map is left untouched.
 */
export function removeIdFromPostings<Term>(
  postings: Map<Term, Set<string>>,
  terms: Iterable<Term> | undefined,
  id: string,
): void {
  if (terms === undefined) {
    return;
  }
  for (const term of terms) {
    const docs = postings.get(term);
    if (!docs) {
      continue;
    }
    docs.delete(id);
    if (docs.size === 0) {
      postings.delete(term);
    }
  }
}
