import { useEffect } from "react";

const SITE_NAME = "Ali Saleh";

/** Set the document title for the current route: "Summary | Ali Saleh". */
export function usePageTitle(title: string) {
  useEffect(() => {
    document.title = `${title} | ${SITE_NAME}`;
  }, [title]);
}
