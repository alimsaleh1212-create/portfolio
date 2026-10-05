import { QueryClientProvider, type QueryClient } from "@tanstack/react-query";
import { Navigate, Route, Routes } from "react-router";

import { Shell } from "./components/Shell";
import { NotFoundPage } from "./pages/NotFoundPage";
import { ProjectPage } from "./pages/ProjectPage";
import { ReadinessPage } from "./pages/ReadinessPage";
import { SummaryPage } from "./pages/SummaryPage";

/** Routes inside the shell. The caller supplies the router, so tests can use a memory router. */
export function App({ queryClient }: { queryClient: QueryClient }) {
  return (
    <QueryClientProvider client={queryClient}>
      <Routes>
        <Route element={<Shell />}>
          {/* "/" belongs to the Climb (ticket #14). Until it exists, send Visitors to the Summary. */}
          <Route index element={<Navigate to="/summary" replace />} />
          <Route path="summary" element={<SummaryPage />} />
          <Route path="projects/:slug" element={<ProjectPage />} />
          <Route path="status" element={<ReadinessPage />} />
          <Route path="*" element={<NotFoundPage />} />
        </Route>
      </Routes>
    </QueryClientProvider>
  );
}
