/** The debug view is asked for in the address: `?debug`. Optionally `&at=3.5` pins the view. */
export function readDebug(search: string): {
  debug: boolean;
  at: number | null;
} {
  const params = new URLSearchParams(search);
  if (!params.has("debug")) return { debug: false, at: null };
  const at = Number(params.get("at"));
  return {
    debug: true,
    at:
      params.get("at") !== null && Number.isFinite(at)
        ? Math.min(6, Math.max(0, at))
        : null,
  };
}
