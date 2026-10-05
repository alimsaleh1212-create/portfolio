export type CheckStatus = "ok" | "fail";

export interface DependencyCheck {
  status: CheckStatus;
  detail: string | null;
}

export interface ReadinessReport {
  status: CheckStatus;
  checks: Record<string, DependencyCheck>;
}

export type ReadinessResult =
  { kind: "report"; report: ReadinessReport } | { kind: "unreachable" };

export const READINESS_URL = "/api/v1/health/ready";

function isReport(value: unknown): value is ReadinessReport {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<ReadinessReport>;
  return (
    typeof candidate.status === "string" && typeof candidate.checks === "object"
  );
}

/**
 * Ask the API for its readiness. Both 200 and 503 carry a report; anything
 * else (network error, a proxy error page, bad JSON) means the API itself is
 * unreachable.
 */
export async function fetchReadiness(): Promise<ReadinessResult> {
  try {
    const response = await fetch(READINESS_URL, {
      headers: { Accept: "application/json" },
    });
    const body: unknown = await response.json();
    if (
      (response.status === 200 || response.status === 503) &&
      isReport(body)
    ) {
      return { kind: "report", report: body };
    }
    return { kind: "unreachable" };
  } catch {
    return { kind: "unreachable" };
  }
}
