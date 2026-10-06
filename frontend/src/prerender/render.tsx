/**
 * The server entry: draw one page of the real app to HTML.
 *
 * It renders the same `App` the browser runs, with the content already in the query cache, so
 * the HTML holds the same text and structure a Visitor's browser would build. Only what runs
 * during a render runs here: nothing in an effect, an event or a browser API (the tier decision,
 * the scene, the still backdrop, the Visit) happens, so a pre-render never starts a Visit and
 * the page is left for the browser to take over (`hydrateRoot` in `main.tsx`).
 */
import { dehydrate, QueryClient } from "@tanstack/react-query";
import { StrictMode } from "react";
import { renderToString } from "react-dom/server";
import { StaticRouter } from "react-router";

import { App } from "../App";
import { SITE_NAME, type HeadModel } from "../head/model";
import { renderHead, scriptJson } from "../head/render";
import { SiteContext } from "../head/useHead";
import {
  mediaQuery,
  profileQuery,
  projectsQuery,
  stagesQuery,
} from "../api/client";
import { DATA_ID } from "./data";
import type { QueryName } from "./pages";

export const QUERIES = {
  profile: profileQuery,
  stages: stagesQuery,
  projects: projectsQuery,
  media: mediaQuery,
} as const;

/** Content as the API returned it, by query. */
export type Content = { [N in QueryName]: unknown };

export interface Rendered {
  html: string;
  head: HeadModel;
  /** What the browser is given: the public address and the content this page was drawn from. */
  data: { siteUrl: string; state: ReturnType<typeof dehydrate> };
}

/**
 * The cache as the browser will be given it. The times are fixed: they mean nothing to a cache
 * that never goes stale (`staleTime` is infinite), and a run then writes the same bytes for the
 * same content, so the browser's revalidation answers 304 until the content changes.
 */
function embeddable(queryClient: QueryClient) {
  const state = dehydrate(queryClient);
  state.queries.forEach((query) => {
    query.state.dataUpdatedAt = 1;
    query.dehydratedAt = 1;
  });
  return { ...state, queries: state.queries };
}

/** Draw `path` with `queries` of the content in the cache. */
export function renderPage(
  path: string,
  queries: QueryName[],
  content: Content,
  siteUrl: string,
): Rendered {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  for (const name of queries) {
    queryClient.setQueryData<unknown>(QUERIES[name].queryKey, content[name]);
  }

  let head: HeadModel = { title: SITE_NAME };
  const html = renderToString(
    <StrictMode>
      <SiteContext
        value={{
          siteUrl,
          collect: (model) => {
            head = model;
          },
        }}
      >
        <StaticRouter location={path}>
          <App queryClient={queryClient} />
        </StaticRouter>
      </SiteContext>
    </StrictMode>,
  );
  return { html, head, data: { siteUrl, state: embeddable(queryClient) } };
}

/**
 * The page's HTML: the built `index.html` with its head replaced by this page's, the drawn app
 * inside `#root`, and the content the app was drawn from for the browser to start with.
 */
export function fillTemplate(template: string, page: Rendered): string {
  const root = '<div id="root"></div>';
  const title = /<title>[^<]*<\/title>/;
  if (!template.includes(root) || !title.test(template)) {
    throw new Error("The built index.html has no #root or no <title>.");
  }
  const data = `<script type="application/json" id="${DATA_ID}">${scriptJson(page.data)}</script>`;
  return template
    .replace(title, () => renderHead(page.head))
    .replace(root, () => `<div id="root">${page.html}</div>\n    ${data}`);
}
