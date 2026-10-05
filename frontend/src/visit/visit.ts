/**
 * Records this page load as a Visit (ADR 0002).
 *
 * A Visit starts once when the app loads and covers every page the Visitor
 * moves between without reloading; reloading starts a new one. Its ID lives in
 * this module's memory only. Nothing here touches cookies, local storage or
 * session storage, and the ID is not written anywhere a reload could read it.
 *
 * Recording never blocks or breaks the page: every failure is swallowed.
 */
import { deviceClass } from "./device";

const VISITS_URL = "/api/v1/visits";

export type VisitEvent =
  | { type: "stage_reached"; stage: string }
  | { type: "project_opened"; project: string }
  | { type: "cv_downloaded" }
  | { type: "contact_message_sent" };

type State =
  | { status: "idle" }
  | { status: "starting"; queue: VisitEvent[] }
  | { status: "started"; id: string }
  // The server gave no ID (a known bot, a rate limit, an error): nothing is recorded.
  | { status: "none" };

let state: State = { status: "idle" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * POST JSON to the API. `keepalive` lets the request finish even when the
 * Visitor leaves the page in the same moment (a download or a link away).
 * `credentials: "omit"` keeps the request from carrying or setting cookies.
 */
function post(url: string, body: unknown): Promise<Response> {
  return fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    keepalive: true,
    credentials: "omit",
  });
}

function send(id: string, event: VisitEvent): void {
  try {
    post(`${VISITS_URL}/${id}/events`, event).catch(() => {});
  } catch {
    // Recording must never break the page.
  }
}

async function requestVisit(): Promise<string | null> {
  const body: Record<string, string> = { device: deviceClass() };
  if (document.referrer) body.referrer = document.referrer;
  const response = await post(VISITS_URL, body);
  if (response.status !== 201) return null;
  const answer: unknown = await response.json();
  const id =
    typeof answer === "object" && answer !== null && "id" in answer
      ? answer.id
      : null;
  return typeof id === "string" && UUID.test(id) ? id : null;
}

/** Start this page load's Visit. Calling it again does nothing, so strict mode's double effects are safe. */
export function startVisit(): void {
  if (state.status !== "idle") return;
  const starting: State = { status: "starting", queue: [] };
  state = starting;
  requestVisit()
    .catch(() => null)
    .then((id) => {
      const queued = starting.queue;
      if (id === null) {
        state = { status: "none" };
        return;
      }
      state = { status: "started", id };
      // Events fired before the ID arrived go out now, in order.
      for (const event of queued) send(id, event);
    });
}

/** Record an event on the Visit. Before the Visit has started it is held and sent once it has. */
export function recordEvent(event: VisitEvent): void {
  switch (state.status) {
    case "started":
      send(state.id, event);
      break;
    case "starting":
      state.queue.push(event);
      break;
    default:
      // Not started, or no ID was given: there is no Visit to add to.
      break;
  }
}

/** Forget the Visit. For tests only. */
export function resetVisitForTests(): void {
  state = { status: "idle" };
}
