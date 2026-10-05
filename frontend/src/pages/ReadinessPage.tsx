import { useEffect, useState } from "react";

import { usePageTitle } from "../usePageTitle";
import { fetchReadiness, type ReadinessResult } from "../api/readiness";

const DEPENDENCIES = [
  { key: "postgres", label: "Postgres" },
  { key: "redis", label: "Redis" },
  { key: "minio", label: "MinIO" },
] as const;

type State = { kind: "loading" } | ReadinessResult;

export function ReadinessPage() {
  usePageTitle("Status");
  const [state, setState] = useState<State>({ kind: "loading" });

  useEffect(() => {
    let cancelled = false;
    void fetchReadiness().then((result) => {
      if (!cancelled) setState(result);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="px-gutter md:px-gutter-wide py-section">
     <div className="max-w-page mx-auto">
      <h1 className="text-2xl font-semibold tracking-snug">Site status</h1>
      <h2 className="text-ink-muted mt-4 text-lg">Readiness</h2>
      {state.kind === "loading" && <p className="mt-2">Checking...</p>}
      {state.kind === "unreachable" && (
        <p role="alert" className="mt-2 text-alert font-medium">
          API unreachable
        </p>
      )}
      {state.kind === "report" && (
        <ul className="mt-2 space-y-1">
          {DEPENDENCIES.map(({ key, label }) => {
            const check = state.report.checks[key];
            const healthy = check?.status === "ok";
            return (
              <li
                key={key}
                data-testid={key}
                className={healthy ? "text-ink" : "text-alert font-medium"}
              >
                {label}: {healthy ? "healthy" : `failing${check?.detail ? ` (${check.detail})` : ""}`}
              </li>
            );
          })}
        </ul>
      )}
     </div>
    </div>
  );
}
