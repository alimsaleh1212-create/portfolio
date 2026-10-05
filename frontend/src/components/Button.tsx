import type { ButtonHTMLAttributes } from "react";

/** The one button style: accent fill, dark text. */
export function Button({ className = "", ...props }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      className={`bg-accent text-on-accent hover:bg-accent-hover rounded-control press px-5 py-3 font-semibold disabled:opacity-70 ${className}`}
      {...props}
    />
  );
}
