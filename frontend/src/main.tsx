import { hydrate } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot, hydrateRoot } from "react-dom/client";
import { BrowserRouter } from "react-router";

import { App } from "./App";
import { createQueryClient } from "./api/client";
import { SiteContext } from "./head/useHead";
import "./index.css";
import { DATA_ID } from "./prerender/data";
import { chooseTier } from "./tier/tier";
import { startVisit } from "./visit/visit";

// The tier is decided first (it is quick and never throws), so the Visit can carry it. One Visit
// per page load, started here rather than in an effect so strict mode cannot start two.
startVisit(chooseTier());

const queryClient = createQueryClient();
const container = document.getElementById("root")!;

// A pre-rendered page carries the content it was drawn from. Putting it in the cache first
// means the first render matches the HTML exactly and nothing is fetched again.
const embedded = readEmbeddedData();
if (embedded) hydrate(queryClient, embedded.state);

const app = (
  <StrictMode>
    <SiteContext value={{ siteUrl: embedded?.siteUrl ?? null, collect: null }}>
      <BrowserRouter>
        <App queryClient={queryClient} />
      </BrowserRouter>
    </SiteContext>
  </StrictMode>
);

// Dev mode serves an empty page: draw it. A pre-rendered page is taken over, not redrawn.
if (embedded && container.hasChildNodes()) hydrateRoot(container, app);
else createRoot(container).render(app);

function readEmbeddedData() {
  const script = document.getElementById(DATA_ID);
  if (!script?.textContent) return null;
  try {
    return JSON.parse(script.textContent) as {
      siteUrl: string;
      state: Parameters<typeof hydrate>[1];
    };
  } catch {
    return null;
  }
}
