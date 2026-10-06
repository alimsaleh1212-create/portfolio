/**
 * Calls `onChange(hidden)` whenever the tab is hidden or shown, and once at the start with
 * the current state. The scene stops rendering while hidden. Returns the function that stops listening.
 */
export function watchVisibility(
  doc: Pick<Document, "hidden" | "addEventListener" | "removeEventListener">,
  onChange: (hidden: boolean) => void,
): () => void {
  const report = () => onChange(doc.hidden);
  doc.addEventListener("visibilitychange", report);
  report();
  return () => doc.removeEventListener("visibilitychange", report);
}
