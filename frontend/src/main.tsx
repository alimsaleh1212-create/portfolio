import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { ReadinessPage } from "./ReadinessPage";
import "./index.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ReadinessPage />
  </StrictMode>,
);
