import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { json, renderApp, stubApi, answerWithContent } from "../test/render";
import { resetVisitForTests, startVisit } from "../visit/visit";

const KEYS = [
  "trailhead",
  "long-approach",
  "steep-switch",
  "ridge",
  "high-camp",
];

beforeEach(() => {
  window.history.replaceState(null, "", "/");
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  resetVisitForTests();
});

describe("the Climb page", () => {
  it("shows the five Stages in the API's order with their content", async () => {
    stubApi(answerWithContent);
    renderApp("/");
    await screen.findByRole("heading", { level: 1, name: "Ali Saleh" });
    const names = screen
      .getAllByRole("heading", { level: 2 })
      .map((heading) => heading.textContent);
    expect(names.slice(0, 5)).toEqual([
      "Trailhead",
      "Long Approach",
      "Steep Switch",
      "Ridge",
      "High Camp",
    ]);
    const trailhead = document.getElementById("trailhead")!;
    expect(within(trailhead).getByText("2016 – 2018")).toBeInTheDocument();
    expect(
      within(trailhead).getByText("I earned two degrees."),
    ).toBeInTheDocument();
    // The Ridge has no period.
    const ridge = document.getElementById("ridge")!;
    expect(ridge.querySelector("p.font-mono")).toBeNull();
  });

  it("marks a placeholder Challenge as not yet written, and only that", async () => {
    stubApi(answerWithContent);
    renderApp("/");
    await screen.findByRole("heading", { level: 1 });
    expect(screen.getAllByText("Not yet written")).toHaveLength(4);
    const steep = document.getElementById("steep-switch")!;
    expect(within(steep).queryByText("Not yet written")).toBeNull();
    expect(
      within(steep).getByText("The Steep Switch Challenge, written."),
    ).toBeInTheDocument();
  });

  it("lists the six Projects on the Ridge, each linking to its page", async () => {
    stubApi(answerWithContent);
    renderApp("/");
    await screen.findByRole("heading", { level: 1 });
    const ridge = document.getElementById("ridge")!;
    const links = within(ridge).getAllByRole("link");
    expect(links).toHaveLength(6);
    expect(links[0]).toHaveAttribute("href", "/projects/one");
    expect(within(ridge).getByText("above 90%")).toBeInTheDocument();
  });

  it("shows the Video CV at High Camp, then the Summit, then the contact section", async () => {
    stubApi(answerWithContent);
    renderApp("/");
    await screen.findByRole("heading", { level: 1 });
    const camp = document.getElementById("high-camp")!;
    expect(
      within(camp).getByRole("heading", { name: "Video CV" }),
    ).toBeInTheDocument();
    const summit = screen.getByRole("heading", {
      name: "The Summit is still ahead.",
    });
    const contact = screen.getByRole("heading", { name: "Send a message" });
    expect(
      camp.compareDocumentPosition(summit) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      summit.compareDocumentPosition(contact) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(document.getElementById("summit")!.nextElementSibling).toBeNull();
  });

  it("offers the Summary on the opening screen", async () => {
    stubApi(answerWithContent);
    renderApp("/");
    await screen.findByRole("heading", { level: 1 });
    expect(
      screen.getByRole("link", { name: "Read the Summary" }),
    ).toHaveAttribute("href", "/summary");
  });

  it("has one h1, a skip link and landmarks", async () => {
    stubApi(answerWithContent);
    renderApp("/");
    await screen.findByRole("heading", { level: 1 });
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(
      screen.getByRole("link", { name: "Skip to content" }),
    ).toHaveAttribute("href", "#main");
    expect(
      screen.getByRole("navigation", { name: "Altitude meter" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("main")).toBeInTheDocument();
  });

  it("holds the layout while loading and offers a retry on failure", async () => {
    let fail = true;
    stubApi((path) =>
      fail && path.endsWith("/stages")
        ? json({ detail: "down" }, 500)
        : answerWithContent(path),
    );
    renderApp("/");
    expect(screen.getByRole("status")).toHaveTextContent("Loading the Climb");
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("The Climb did not load");
    fail = false;
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(
      await screen.findByRole("heading", { level: 1, name: "Ali Saleh" }),
    ).toBeInTheDocument();
  });
});

/** Place the Stages at fixed document positions and scroll to `y`. */
function scrollTo(y: number) {
  Object.defineProperty(window, "scrollY", { value: y, configurable: true });
  act(() => {
    window.dispatchEvent(new Event("scroll"));
  });
}

function layOutStages() {
  const tops = Object.fromEntries(KEYS.map((key, i) => [key, 1000 + i * 1000]));
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(
    function (this: Element) {
      return { top: (tops[this.id] ?? 9000) - window.scrollY } as DOMRect;
    },
  );
  window.innerHeight = 800;
  vi.spyOn(window, "requestAnimationFrame").mockImplementation((cb) => {
    cb(0);
    return 0;
  });
  Object.defineProperty(window, "scrollY", { value: 0, configurable: true });
}

function visitApi() {
  const events: string[] = [];
  const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (init?.method === "POST" && url.endsWith("/visits")) {
      return Promise.resolve(
        json({ id: "11111111-1111-4111-8111-111111111111" }, 201),
      );
    }
    if (init?.method === "POST") {
      const body = JSON.parse(String(init.body)) as {
        type: string;
        stage: string;
      };
      if (body.type === "stage_reached") events.push(body.stage);
      return Promise.resolve(new Response(null, { status: 204 }));
    }
    return Promise.resolve(answerWithContent(url));
  });
  vi.stubGlobal("fetch", fetchMock);
  return events;
}

describe("Stage reached", () => {
  it("is recorded once per Stage as the Visitor scrolls down and back", async () => {
    layOutStages();
    const events = visitApi();
    startVisit();
    renderApp("/");
    await screen.findByRole("heading", { level: 1 });
    expect(events).toEqual([]);
    for (const y of [0, 300, 700, 1500, 2600, 3500, 4600, 2000, 0, 4600])
      scrollTo(y);
    await waitFor(() => expect(events).toEqual(KEYS));
  });

  it("counts a Stage the Visitor flung past, and none below the fold of an unscrolled page", async () => {
    layOutStages();
    const events = visitApi();
    startVisit();
    renderApp("/");
    await screen.findByRole("heading", { level: 1 });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(events).toEqual([]);
    scrollTo(4600);
    await waitFor(() => expect(events).toEqual(KEYS));
  });
});

describe("the altitude meter", () => {
  it("tracks the current Stage and tells a screen reader", async () => {
    layOutStages();
    stubApi(answerWithContent);
    renderApp("/");
    await screen.findByRole("heading", { level: 1 });
    const meter = screen.getByRole("meter", { name: "Altitude" });
    expect(meter).toHaveAttribute("aria-valuenow", "0");
    scrollTo(3700);
    const nav = screen.getByRole("navigation", { name: "Altitude meter" });
    await waitFor(() =>
      expect(within(nav).getByRole("link", { name: "Ridge" })).toHaveAttribute(
        "aria-current",
        "step",
      ),
    );
    expect(within(nav).getByRole("status")).toHaveTextContent("Now at Ridge");
    expect(meter).toHaveAttribute("aria-valuenow", "68");
    expect(meter.getAttribute("aria-valuetext")).toMatch(
      /^Ridge, 68% of the way up$/,
    );
  });

  it("moves to a Stage when a marker is chosen, by keyboard too", async () => {
    stubApi(answerWithContent);
    renderApp("/");
    await screen.findByRole("heading", { level: 1 });
    const scrollIntoView = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoView;
    const reduced = vi
      .spyOn(window, "matchMedia")
      .mockImplementation(
        (query) => ({ matches: true, media: query }) as MediaQueryList,
      );
    const nav = screen.getByRole("navigation", { name: "Altitude meter" });
    const marker = within(nav).getByRole("link", { name: "Steep Switch" });
    marker.focus();
    await userEvent.keyboard("{Enter}");
    expect(scrollIntoView).toHaveBeenCalledWith({
      behavior: "auto",
      block: "start",
    });
    expect(document.activeElement).toBe(
      document.getElementById("steep-switch"),
    );
    expect(window.location.hash).toBe("#steep-switch");
    reduced.mockImplementation(
      (query) => ({ matches: false, media: query }) as MediaQueryList,
    );
    await userEvent.click(marker);
    expect(scrollIntoView).toHaveBeenLastCalledWith({
      behavior: "smooth",
      block: "start",
    });
  });
});

describe("direct links", () => {
  it("opens at the Stage named in the address", async () => {
    stubApi(answerWithContent);
    const scrollIntoView = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoView;
    renderApp("/#ridge");
    await screen.findByRole("heading", { level: 1 });
    await waitFor(() => expect(scrollIntoView).toHaveBeenCalled());
    expect(document.activeElement).toBe(document.getElementById("ridge"));
  });
});
