import type { PostgrestError } from "@supabase/supabase-js";

const PAGE_SIZE = 1000;

/**
 * Paginated SELECT helper that works around Supabase's default 1000-row cap.
 * Pass a builder that applies `.range(from, to)` to a query and returns the
 * supabase query promise. Returns the full concatenated result set.
 *
 * Example:
 *   const rows = await selectAll<MyRow>((from, to) =>
 *     supabase.from('table').select('*').order('id').range(from, to)
 *   );
 */
export async function selectAll<T = any>(
  buildQuery: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: PostgrestError | null }>
): Promise<T[]> {
  const all: T[] = [];
  let from = 0;
  // Safety cap: 1,000,000 rows max to avoid runaway loops.
  const HARD_CAP = 1_000_000;
  while (from < HARD_CAP) {
    const to = from + PAGE_SIZE - 1;
    const { data, error } = await buildQuery(from, to);
    if (error) {
      // PostgREST returns 416 when the requested range is past the end.
      // Treat as a clean end-of-data.
      const code = (error as any).code as string | undefined;
      const status = (error as any).status as number | undefined;
      if (code === "PGRST103" || status === 416) break;
      throw error;
    }
    if (!data || data.length === 0) break;
    all.push(...data);
    if (data.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }
  return all;
}

/**
 * Chunked SELECT for `.in('col', ids)` queries. PostgREST returns 400 when the
 * URL gets too long, so we split `ids` into chunks and run `selectAll` per chunk.
 *
 * Example:
 *   const rows = await selectAllInChunks<MyRow>(ids, (chunk, from, to) =>
 *     supabase.from('table').select('*').in('id', chunk).range(from, to)
 *   );
 */
export async function selectAllInChunks<T = any>(
  ids: string[],
  buildQuery: (chunk: string[], from: number, to: number) => PromiseLike<{ data: T[] | null; error: PostgrestError | null }>,
  chunkSize = 100
): Promise<T[]> {
  if (!ids || ids.length === 0) return [];
  const out: T[] = [];
  for (let i = 0; i < ids.length; i += chunkSize) {
    const chunk = ids.slice(i, i + chunkSize);
    const rows = await selectAll<T>((from, to) => buildQuery(chunk, from, to));
    out.push(...rows);
  }
  return out;
}
