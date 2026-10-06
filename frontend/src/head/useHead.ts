import { createContext, useContext, useEffect } from "react";

import { headTags, type HeadModel } from "./model";
import { HEAD_MARK } from "./render";

/**
 * What a page needs to know about where it is shown. The pre-render supplies the public
 * address and a `collect` function that takes the head a page asks for; in the browser the
 * public address is the one the pre-render embedded, or the page's own origin (dev mode).
 */
export interface SiteContextValue {
  siteUrl: string | null;
  collect: ((model: HeadModel) => void) | null;
}

export const SiteContext = createContext<SiteContextValue>({
  siteUrl: null,
  collect: null,
});

/** The site's public address, no trailing slash. */
export function useSiteUrl(): string {
  const { siteUrl } = useContext(SiteContext);
  if (siteUrl !== null) return siteUrl;
  return typeof window === "undefined" ? "" : window.location.origin;
}

/** Replace the elements an earlier page put in the head with this page's. */
function apply(model: HeadModel) {
  document.title = model.title;
  for (const old of document.head.querySelectorAll(`[${HEAD_MARK}]`)) {
    old.remove();
  }
  for (const { tag, attrs, text } of headTags(model)) {
    const element = document.createElement(tag);
    for (const [name, value] of Object.entries(attrs)) {
      element.setAttribute(name, value);
    }
    element.setAttribute(HEAD_MARK, "");
    if (text !== undefined) element.textContent = text;
    document.head.append(element);
  }
}

/**
 * Give the page its head. During the pre-render it hands the model to the collector, which is
 * how the HTML gets its title and tags from the same code that draws the page. In the browser
 * it applies the model, so moving between pages keeps the title, description and tags current.
 */
export function useHead(model: HeadModel) {
  const { collect } = useContext(SiteContext);
  collect?.(model);
  const key = JSON.stringify(model);
  useEffect(() => {
    apply(JSON.parse(key) as HeadModel);
  }, [key]);
}
