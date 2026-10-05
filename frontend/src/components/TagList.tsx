/** A row of short labels, such as a Project's stack or a skill category's items. */
export function TagList({ items, label }: { items: string[]; label: string }) {
  return (
    <ul aria-label={label} className="flex flex-wrap gap-2">
      {items.map((item) => (
        <li
          key={item}
          className="border-line text-ink rounded-control border px-2.5 py-1 font-mono text-sm leading-snug"
        >
          {item}
        </li>
      ))}
    </ul>
  );
}
