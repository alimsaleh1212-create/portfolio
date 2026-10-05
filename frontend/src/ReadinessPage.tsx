import { useEffect, useState } from "react";

import { fetchReadiness, type ReadinessResult } from "./readiness";

const DEPENDENCIES = [
  { key: "postgres", label: "Postgres" },
  { key: "redis", label: "Redis" },
  { key: "minio", label: "MinIO" },
] as const;

type State = { kind: "loading" } | ReadinessResult;

export function ReadinessPage() {
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
    <main className="mx-auto max-w-md p-6">
      <h1 className="text-2xl font-semibold">Ali Saleh</h1>
      <h2 className="mt-4 text-lg">Readiness</h2>
      {state.kind === "loading" && <p>Checking...</p>}
      {state.kind === "unreachable" && (
        <p role="alert" className="mt-2 font-medium text-red-700">
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
                className={healthy ? "text-green-700" : "font-medium text-red-700"}
              >
                {label}: {healthy ? "healthy" : `failing${check?.detail ? ` (${check.detail})` : ""}`}
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}
