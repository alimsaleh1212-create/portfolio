import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router";

import { App } from "./App";
import { createQueryClient } from "./api/client";
import "./index.css";
import { chooseTier } from "./tier/tier";
import { startVisit } from "./visit/visit";

// The tier is decided first (it is quick and never throws), so the Visit can carry it. One Visit
// per page load, started here rather than in an effect so strict mode cannot start two.
startVisit(chooseTier());

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <App queryClient={createQueryClient()} />
    </BrowserRouter>
  </StrictMode>,
);
