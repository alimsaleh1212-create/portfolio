import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { resetVisitForTests, startVisit } from "../visit/visit";
import { profile } from "../test/fixtures";
import { ContactSection } from "./ContactSection";

const VISIT_ID = "3f2b8c1e-9d4a-4e6f-8a7b-1c2d3e4f5a6b";
const NAME = "Test Visitor";
const EMAIL = "visitor@example.com";
const TEXT = "I would like to talk about an agent project.";

type Handler = (body: Record<string, unknown>) => Response | Promise<Response>;

/** Stubs the Visit endpoints and the contact endpoint; returns the fetch mock. */
function stubServer(contact: Handler) {
  const fetchMock = vi.fn<typeof fetch>((input, init) => {
    const url = String(input);
    if (url.endsWith("/visits"))
      return Promise.resolve(
        new Response(JSON.stringify({ id: VISIT_ID }), { status: 201 }),
      );
    if (url.includes("/events"))
      return Promise.resolve(new Response(null, { status: 204 }));
    return Promise.resolve(contact(JSON.parse(String(init?.body))));
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

const created = () =>
  new Response(JSON.stringify({ received: true }), { status: 201 });
const refused = (status: number, body: unknown = {}) =>
  new Response(JSON.stringify(body), { status });

const contactCalls = (fetchMock: ReturnType<typeof vi.fn>) =>
  fetchMock.mock.calls.filter((call) => String(call[0]).endsWith("/contact"));
const eventCalls = (fetchMock: ReturnType<typeof vi.fn>) =>
  fetchMock.mock.calls
    .filter((call) => String(call[0]).includes("/events"))
    .map((call) => JSON.parse(String((call[1] as RequestInit).body)));

const field = (name: string) => screen.getByRole("textbox", { name });

async function fill(
  user: ReturnType<typeof userEvent.setup>,
  values: { name?: string; email?: string; message?: string } = {},
) {
  const { name = NAME, email = EMAIL, message = TEXT } = values;
  if (name) await user.type(field("Name"), name);
  if (email) await user.type(field("Email address"), email);
  if (message) await user.type(field("Message"), message);
}

const send = (user: ReturnType<typeof userEvent.setup>) =>
  user.click(screen.getByRole("button", { name: "Send message" }));

beforeEach(() => {
  resetVisitForTests();
  document.title = "";
});
afterEach(() => vi.unstubAllGlobals());

describe("ready", () => {
  it("shows an empty form with a label on every field", () => {
    stubServer(created);
    render(<ContactSection links={profile.links} />);

    expect(
      screen.getByRole("heading", { level: 2, name: "Send a message" }),
    ).toBeInTheDocument();
    for (const name of ["Name", "Email address", "Message"]) {
      expect(field(name)).toBeRequired();
      expect(field(name)).toHaveValue("");
      expect(field(name)).toHaveAttribute("aria-invalid", "false");
    }
    expect(
      screen.getByRole("button", { name: "Send message" }),
    ).toBeInTheDocument();
  });

  it("gives browsers the right types and autocomplete hints", () => {
    stubServer(created);
    render(<ContactSection links={profile.links} />);

    expect(field("Name")).toHaveAttribute("autocomplete", "name");
    expect(field("Name")).toHaveAttribute("name", "name");
    expect(field("Email address")).toHaveAttribute("type", "email");
    expect(field("Email address")).toHaveAttribute("autocomplete", "email");
    expect(field("Email address")).toHaveAttribute("name", "email");
    expect(field("Message").tagName).toBe("TEXTAREA");
  });

  it("links to Ali's email, LinkedIn and GitHub from the profile, and shows no phone number", () => {
    stubServer(created);
    const { container } = render(<ContactSection links={profile.links} />);

    const links = screen.getByRole("navigation", {
      name: "Other ways to reach me",
    });
    expect(
      within(links).getByRole("link", { name: profile.links.email }),
    ).toHaveAttribute("href", `mailto:${profile.links.email}`);
    expect(
      within(links).getByRole("link", { name: "linkedin.com/in/ali-example" }),
    ).toHaveAttribute("href", profile.links.linkedin);
    expect(
      within(links).getByRole("link", { name: "github.com/ali-example" }),
    ).toHaveAttribute("href", profile.links.github);
    expect(container.textContent).not.toMatch(/\+?\d[\d\s().-]{7,}\d/);
    expect(container.querySelector('a[href^="tel:"]')).toBeNull();
  });

  it("stands alone, without a router or a query client", () => {
    stubServer(created);
    expect(() =>
      render(<ContactSection links={profile.links} />),
    ).not.toThrow();
  });
});

describe("the honeypot", () => {
  it("is out of sight, out of the tab order and hidden from assistive technology", async () => {
    stubServer(created);
    const user = userEvent.setup();
    const { container } = render(<ContactSection links={profile.links} />);

    const trap = container.querySelector<HTMLInputElement>(
      'input[name="website"]',
    )!;
    expect(trap.closest("[aria-hidden='true']")).not.toBeNull();
    expect(trap).toHaveAttribute("tabindex", "-1");
    expect(trap).toHaveAttribute("autocomplete", "off");
    expect(
      screen.queryByRole("textbox", { name: /leave this field empty/i }),
    ).toBeNull();

    // Tab through the whole form: the trap is never reached.
    const reached: Element[] = [];
    for (let i = 0; i < 12; i++) {
      await user.tab();
      reached.push(document.activeElement!);
    }
    expect(reached).not.toContain(trap);
  });

  it("is sent as it was left", async () => {
    const fetchMock = stubServer(created);
    const user = userEvent.setup();
    render(<ContactSection links={profile.links} />);
    await fill(user);
    await send(user);

    await screen.findByText("Message sent");
    const [call] = contactCalls(fetchMock);
    expect(JSON.parse(String((call[1] as RequestInit).body))).toEqual({
      name: NAME,
      email: EMAIL,
      message: TEXT,
      website: "",
    });
  });
});

describe("validation in the browser", () => {
  it("shows each error beside its field, tied to it, and focuses the first", async () => {
    const fetchMock = stubServer(created);
    const user = userEvent.setup();
    render(<ContactSection links={profile.links} />);
    await user.type(field("Email address"), "not-an-address");
    await user.type(field("Message"), "short");

    await send(user);

    expect(field("Name")).toHaveAccessibleDescription("Enter your name.");
    expect(field("Name")).toBeInvalid();
    expect(field("Email address")).toHaveAccessibleDescription(
      /I only use it to reply to you\.\s*Enter a valid email address/,
    );
    expect(field("Message")).toHaveAccessibleDescription(
      "Write at least 10 characters.",
    );
    expect(field("Name")).toHaveFocus();
    expect(contactCalls(fetchMock)).toHaveLength(0);
  });

  it("keeps what was typed, and focuses the first field in error even when it is not the first field", async () => {
    stubServer(created);
    const user = userEvent.setup();
    render(<ContactSection links={profile.links} />);
    await fill(user, { email: "nope" });

    await send(user);

    expect(field("Email address")).toHaveFocus();
    expect(field("Name")).toHaveValue(NAME);
    expect(field("Email address")).toHaveValue("nope");
    expect(field("Message")).toHaveValue(TEXT);
  });

  it("clears an error once the field is put right", async () => {
    stubServer(created);
    const user = userEvent.setup();
    render(<ContactSection links={profile.links} />);
    await fill(user, { email: "nope" });
    await send(user);
    expect(field("Email address")).toBeInvalid();

    await user.clear(field("Email address"));
    await user.type(field("Email address"), EMAIL);

    expect(field("Email address")).toBeValid();
    expect(screen.queryByText(/Enter a valid email/)).toBeNull();
  });
});

describe("validation from the server", () => {
  it("shows the server's field errors in the same places and keeps the input", async () => {
    stubServer(() =>
      refused(422, {
        errors: {
          email: "Enter a valid email address, like name@example.com.",
          message: "Your message contains characters that cannot be sent.",
        },
      }),
    );
    const user = userEvent.setup();
    render(<ContactSection links={profile.links} />);
    await fill(user);

    await send(user);

    await waitFor(() => expect(field("Email address")).toBeInvalid());
    expect(field("Email address")).toHaveAccessibleDescription(
      /Enter a valid email address, like name@example.com\./,
    );
    expect(field("Message")).toHaveAccessibleDescription(
      "Your message contains characters that cannot be sent.",
    );
    expect(field("Name")).toBeValid();
    expect(field("Email address")).toHaveFocus();
    expect(field("Name")).toHaveValue(NAME);
    expect(field("Message")).toHaveValue(TEXT);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("treats a 422 it cannot read as a failure", async () => {
    stubServer(() => refused(422, { detail: "odd" }));
    const user = userEvent.setup();
    render(<ContactSection links={profile.links} />);
    await fill(user);

    await send(user);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Your message did not send.",
    );
  });
});

describe("sending", () => {
  it("shows a sending state, announces it, and does not send twice", async () => {
    let release: (response: Response) => void = () => {};
    const fetchMock = stubServer(
      () => new Promise<Response>((resolve) => (release = resolve)),
    );
    const user = userEvent.setup();
    render(<ContactSection links={profile.links} />);
    await fill(user);

    await send(user);

    const button = screen.getByRole("button", { name: "Sending…" });
    expect(button).toHaveAttribute("aria-disabled", "true");
    expect(screen.getByRole("status")).toHaveTextContent(
      "Sending your message.",
    );
    expect(document.querySelector("form")).toHaveAttribute("aria-busy", "true");
    await user.click(button);
    expect(contactCalls(fetchMock)).toHaveLength(1);

    release(created());
    await screen.findByText("Message sent");
  });
});

describe("sent", () => {
  it("confirms, announces it to assistive technology and clears the form", async () => {
    stubServer(created);
    const user = userEvent.setup();
    render(<ContactSection links={profile.links} />);
    await fill(user);

    await send(user);

    const status = await screen.findByRole("status");
    expect(status).toHaveTextContent("Message sent");
    expect(status).toHaveTextContent("I will reply by email.");
    expect(screen.queryByRole("textbox", { name: "Name" })).toBeNull();
    await waitFor(() => expect(status).toHaveFocus());
  });

  it("offers another message with an empty form", async () => {
    stubServer(created);
    const user = userEvent.setup();
    render(<ContactSection links={profile.links} />);
    await fill(user);
    await send(user);

    await user.click(
      await screen.findByRole("button", { name: "Send another message" }),
    );

    expect(field("Name")).toHaveValue("");
    expect(field("Message")).toHaveValue("");
    expect(screen.getByRole("status")).toBeEmptyDOMElement();
  });

  it("records the contact message sent event on the Visit, and nothing else about it", async () => {
    const fetchMock = stubServer(created);
    startVisit();
    await vi.waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/v1/visits",
        expect.anything(),
      ),
    );
    const user = userEvent.setup();
    render(<ContactSection links={profile.links} />);
    await fill(user);

    await send(user);

    await vi.waitFor(() =>
      expect(eventCalls(fetchMock)).toEqual([{ type: "contact_message_sent" }]),
    );
    const eventUrls = fetchMock.mock.calls
      .map((call) => String(call[0]))
      .filter((url) => url.includes("/events"));
    expect(eventUrls).toEqual([`/api/v1/visits/${VISIT_ID}/events`]);
    // The message request carries no Visit ID, and the event no personal detail.
    const [call] = contactCalls(fetchMock);
    expect(String((call[1] as RequestInit).body)).not.toContain(VISIT_ID);
    expect(JSON.stringify(eventCalls(fetchMock))).not.toContain(EMAIL);
  });

  it("records no event when the message is not sent", async () => {
    const fetchMock = stubServer(() => refused(503));
    startVisit();
    const user = userEvent.setup();
    render(<ContactSection links={profile.links} />);
    await fill(user);

    await send(user);
    await screen.findByRole("alert");

    expect(eventCalls(fetchMock)).toEqual([]);
  });
});

describe("failed", () => {
  it.each([
    ["the server errs", () => refused(503)],
    ["the network drops", () => Promise.reject(new TypeError("offline"))],
  ])(
    "keeps everything typed and says what to do when %s",
    async (_, answer) => {
      stubServer(answer as Handler);
      const user = userEvent.setup();
      render(<ContactSection links={profile.links} />);
      await fill(user);

      await send(user);

      const alert = await screen.findByRole("alert");
      expect(alert).toHaveTextContent("Your message did not send.");
      expect(alert).toHaveTextContent("Everything you wrote is still here.");
      expect(alert).toHaveTextContent("press Send message again");
      expect(within(alert).getByRole("link")).toHaveAttribute(
        "href",
        `mailto:${profile.links.email}`,
      );
      expect(field("Name")).toHaveValue(NAME);
      expect(field("Email address")).toHaveValue(EMAIL);
      expect(field("Message")).toHaveValue(TEXT);
      expect(
        screen.getByRole("button", { name: "Send message" }),
      ).not.toHaveAttribute("aria-disabled", "true");
    },
  );

  it("can be tried again and then succeeds", async () => {
    let attempts = 0;
    stubServer(() => (++attempts === 1 ? refused(503) : created()));
    const user = userEvent.setup();
    render(<ContactSection links={profile.links} />);
    await fill(user);
    await send(user);
    await screen.findByRole("alert");

    await send(user);

    expect(await screen.findByText("Message sent")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).toBeNull();
  });
});

describe("rate limited", () => {
  it("has its own clear message, keeps the input and offers email", async () => {
    stubServer(() => refused(429, { detail: "Too many messages" }));
    const user = userEvent.setup();
    render(<ContactSection links={profile.links} />);
    await fill(user);

    await send(user);

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(
      "You have sent several messages in the last hour.",
    );
    expect(alert).toHaveTextContent("Try again in an hour");
    expect(alert).not.toHaveTextContent("did not send");
    expect(within(alert).getByRole("link")).toHaveAttribute(
      "href",
      `mailto:${profile.links.email}`,
    );
    expect(field("Message")).toHaveValue(TEXT);
  });
});

describe("unsent text", () => {
  const leave = () => {
    const event = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(event);
    return event.defaultPrevented;
  };

  it("asks before the page is left only while something is typed and unsent", async () => {
    stubServer(created);
    const user = userEvent.setup();
    render(<ContactSection links={profile.links} />);
    expect(leave()).toBe(false);

    await fill(user);
    expect(leave()).toBe(true);

    await send(user);
    await screen.findByText("Message sent");
    expect(leave()).toBe(false);
  });
});

describe("what the form keeps", () => {
  it("writes nothing to cookies or storage", async () => {
    stubServer(created);
    const user = userEvent.setup();
    render(<ContactSection links={profile.links} />);
    await fill(user);
    await send(user);
    await screen.findByText("Message sent");

    expect(document.cookie).toBe("");
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
  });

  it("sends the request without credentials, to our own origin", async () => {
    const fetchMock = stubServer(created);
    const user = userEvent.setup();
    render(<ContactSection links={profile.links} />);
    await fill(user);
    await send(user);
    await screen.findByText("Message sent");

    const [call] = contactCalls(fetchMock);
    expect(call[0]).toBe("/api/v1/contact");
    expect((call[1] as RequestInit).credentials).toBe("omit");
  });
});
