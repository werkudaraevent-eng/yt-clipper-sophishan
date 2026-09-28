/** Mirrors public.project_credit_cost in supabase/migrations: 1 credit per started minute. */
export function creditCost(start: number, end: number, duration?: number | null): number {
  const stop = duration != null ? Math.min(end, duration) : end;
  return Math.max(1, Math.ceil(Math.max(0, stop - start) / 60));
}
