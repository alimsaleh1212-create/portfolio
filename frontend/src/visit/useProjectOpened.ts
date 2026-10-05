import { useEffect, useRef } from "react";

import { recordEvent } from "./visit";

/**
 * Record "Project opened" once per page view of a Project.
 *
 * The ref survives strict mode's second effect run, so the dev double-run does
 * not record twice, while moving to another Project and back records again.
 */
export function useProjectOpened(slug: string | undefined): void {
  const recorded = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (!slug || recorded.current === slug) return;
    recorded.current = slug;
    recordEvent({ type: "project_opened", project: slug });
  }, [slug]);
}
