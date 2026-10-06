import { useEffect, useId, useRef, useState, type FormEvent } from "react";

import {
  sendMessage,
  validate,
  type ContactField,
  type ContactValues,
  type FieldErrors,
} from "../api/contact";
import type { Links } from "../api/types";
import { displayUrl } from "../displayUrl";
import { recordEvent } from "../visit/visit";
import { buttonClass } from "./Button";

type Status = "ready" | "sending" | "sent" | "failed" | "rate_limited";

const EMPTY: ContactValues = { name: "", email: "", message: "" };
const FIELD_ORDER: ContactField[] = ["name", "email", "message"];

const inputClass =
  "bg-raised border-line-strong text-ink placeholder:text-ink-muted w-full rounded-control border px-4 py-3 transition-colors aria-[invalid=true]:border-alert";
const labelClass = "text-ink block text-sm font-medium";

/**
 * The contact section: a message form and links to email, LinkedIn and GitHub.
 *
 * It depends on nothing about the page it sits in, so the Summary and High Camp
 * use the same component. `links` is the profile's `links`. Ali's phone number
 * is not part of the profile's links and never appears here.
 */
export function ContactSection({
  links,
  className = "",
}: {
  links: Links;
  className?: string;
}) {
  const uid = useId();
  const headingId = `${uid}-heading`;
  const [values, setValues] = useState<ContactValues>(EMPTY);
  const [trap, setTrap] = useState("");
  const [errors, setErrors] = useState<FieldErrors>({});
  const [status, setStatus] = useState<Status>("ready");
  const fields = useRef<Partial<Record<ContactField, HTMLElement | null>>>({});
  const confirmation = useRef<HTMLDivElement>(null);

  // Leaving with a message half written loses it, so the browser asks first.
  const unsent = status !== "sent" && Object.values(values).some((v) => v);
  useEffect(() => {
    if (!unsent) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [unsent]);

  const focusFirstError = (found: FieldErrors) => {
    const first = FIELD_ORDER.find((field) => found[field]);
    if (first) fields.current[first]?.focus();
  };

  const change = (field: ContactField, value: string) => {
    const next = { ...values, [field]: value };
    setValues(next);
    // An error goes away as soon as what was typed no longer earns it.
    if (errors[field]) {
      const stillWrong = validate(next)[field];
      setErrors({ ...errors, [field]: stillWrong });
    }
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (status === "sending") return;
    const found = validate(values);
    setErrors(found);
    if (Object.keys(found).length > 0) {
      setStatus("ready");
      focusFirstError(found);
      return;
    }
    setStatus("sending");
    const result = await sendMessage(values, trap);
    switch (result.kind) {
      case "sent":
        setValues(EMPTY);
        setErrors({});
        setStatus("sent");
        recordEvent({ type: "contact_message_sent" });
        // The form is gone, so keep the Visitor's place: on the confirmation.
        requestAnimationFrame(() => confirmation.current?.focus());
        break;
      case "invalid":
        setErrors(result.errors);
        setStatus("ready");
        focusFirstError(result.errors);
        break;
      case "rate_limited":
        setStatus("rate_limited");
        break;
      case "failed":
        setStatus("failed");
        break;
    }
  };

  const sending = status === "sending";
  const mailto = `mailto:${links.email}`;

  return (
    <section
      id="contact"
      aria-labelledby={headingId}
      className={`scroll-mt-8 ${className}`}
    >
      {/* First light along the horizon: the page's last word. */}
      <div aria-hidden="true" className="bg-horizon mb-12 h-px" />
      <h2 id={headingId} className="text-xl font-semibold tracking-snug">
        Send a message
      </h2>

      {/* Always on the page, so a screen reader hears each change of state. */}
      <div
        ref={confirmation}
        role="status"
        tabIndex={-1}
        className="outline-none"
      >
        {sending && <span className="sr-only">Sending your message.</span>}
        {status === "sent" && (
          <div className="bg-raised border-line mt-6 max-w-measure animate-rise rounded-surface border p-6">
            <p className="text-lg font-semibold">Message sent</p>
            <p className="text-ink-muted mt-2">
              Thank you for writing. I will reply by email.
            </p>
          </div>
        )}
      </div>

      {status === "sent" ? (
        <button
          type="button"
          onClick={() => setStatus("ready")}
          className="link press mt-2 py-2 text-sm"
        >
          Send another message
        </button>
      ) : (
        <form
          noValidate
          onSubmit={submit}
          aria-busy={sending}
          className="mt-6 max-w-measure space-y-6"
        >
          <p className="text-ink-muted">
            Tell me about the role or the project. All fields are required.
          </p>

          <Field
            id={`${uid}-name`}
            label="Name"
            error={errors.name}
            inputRef={(el) => (fields.current.name = el)}
          >
            {(props) => (
              <input
                {...props}
                type="text"
                name="name"
                autoComplete="name"
                value={values.name}
                onChange={(e) => change("name", e.target.value)}
                className={inputClass}
              />
            )}
          </Field>

          <Field
            id={`${uid}-email`}
            label="Email address"
            hint="I only use it to reply to you."
            error={errors.email}
            inputRef={(el) => (fields.current.email = el)}
          >
            {(props) => (
              <input
                {...props}
                type="email"
                name="email"
                autoComplete="email"
                inputMode="email"
                autoCapitalize="none"
                spellCheck={false}
                value={values.email}
                onChange={(e) => change("email", e.target.value)}
                className={inputClass}
              />
            )}
          </Field>

          <Field
            id={`${uid}-message`}
            label="Message"
            error={errors.message}
            inputRef={(el) => (fields.current.message = el)}
          >
            {(props) => (
              <textarea
                {...props}
                name="message"
                rows={6}
                value={values.message}
                onChange={(e) => change("message", e.target.value)}
                className={`${inputClass} resize-y`}
              />
            )}
          </Field>

          {/* The honeypot. A person never sees it, and the keyboard and screen readers skip it; a script that fills every field fills this one. */}
          <div aria-hidden="true" className="sr-only">
            <label>
              Leave this field empty
              <input
                type="text"
                name="website"
                tabIndex={-1}
                autoComplete="off"
                data-1p-ignore
                data-lpignore="true"
                data-form-type="other"
                value={trap}
                onChange={(e) => setTrap(e.target.value)}
              />
            </label>
          </div>

          {status === "failed" && (
            <p
              role="alert"
              className="border-alert text-ink rounded-control border p-4"
            >
              <span className="text-alert font-semibold">
                Your message did not send.
              </span>{" "}
              Everything you wrote is still here. Check your connection and
              press Send message again, or email me at{" "}
              <a href={mailto} translate="no" className="link break-words">
                {links.email}
              </a>
              .
            </p>
          )}
          {status === "rate_limited" && (
            <p
              role="alert"
              className="border-alert text-ink rounded-control border p-4"
            >
              <span className="text-alert font-semibold">
                You have sent several messages in the last hour.
              </span>{" "}
              I paused sending to keep the form free of spam. Your text is still
              here. Try again in an hour, or email me at{" "}
              <a href={mailto} translate="no" className="link break-words">
                {links.email}
              </a>
              .
            </p>
          )}

          <button
            type="submit"
            aria-disabled={sending}
            className={`${buttonClass} w-full sm:w-auto aria-disabled:opacity-70`}
          >
            {sending ? "Sending…" : "Send message"}
          </button>
        </form>
      )}

      <nav aria-label="Other ways to reach me" className="mt-12">
        <h3 className="text-ink-muted text-sm font-medium">
          Or reach me directly
        </h3>
        <ul className="mt-3 space-y-3">
          <DirectLink label="Email" href={mailto} text={links.email} />
          <DirectLink
            label="LinkedIn"
            href={links.linkedin}
            text={displayUrl(links.linkedin)}
          />
          <DirectLink
            label="GitHub"
            href={links.github}
            text={displayUrl(links.github)}
          />
        </ul>
      </nav>
    </section>
  );
}

interface ControlProps {
  id: string;
  ref: (el: HTMLInputElement & HTMLTextAreaElement) => void;
  required: true;
  "aria-invalid": boolean;
  "aria-describedby": string | undefined;
}

/** A label above a control, an optional hint, and the error below, all tied to the control. */
function Field({
  id,
  label,
  hint,
  error,
  inputRef,
  children,
}: {
  id: string;
  label: string;
  hint?: string;
  error?: string;
  inputRef: (el: HTMLElement | null) => void;
  children: (props: ControlProps) => React.ReactNode;
}) {
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const describedBy =
    [hint ? hintId : null, error ? errorId : null].filter(Boolean).join(" ") ||
    undefined;
  return (
    <div>
      <label htmlFor={id} className={labelClass}>
        {label}
      </label>
      {hint && (
        <p id={hintId} className="text-ink-muted mt-1 text-sm">
          {hint}
        </p>
      )}
      <div className="mt-2">
        {children({
          id,
          ref: inputRef,
          required: true,
          "aria-invalid": Boolean(error),
          "aria-describedby": describedBy,
        })}
      </div>
      {error && (
        <p id={errorId} className="text-alert mt-2 text-sm">
          {error}
        </p>
      )}
    </div>
  );
}

function DirectLink({
  label,
  href,
  text,
}: {
  label: string;
  href: string;
  text: string;
}) {
  return (
    <li>
      <span className="text-ink-muted block text-sm">{label}</span>
      <a
        href={href}
        translate="no"
        className="link break-words font-mono text-sm"
      >
        {text}
      </a>
    </li>
  );
}
