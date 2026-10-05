import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router";

import { App } from "./App";
import { createQueryClient } from "./api/client";
import "./index.css";
import { startVisit } from "./visit/visit";

// One Visit per page load, started here rather than in an effect so strict mode cannot start two.
startVisit();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <App queryClient={createQueryClient()} />
    </BrowserRouter>
  </StrictMode>,
);
