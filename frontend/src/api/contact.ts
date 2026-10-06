/**
 * Sending a contact message.
 *
 * Like the Visit module this sends no cookies, and it keeps nothing the Visitor
 * typed anywhere but in the form. The "contact message sent" event on the Visit
 * is recorded by the form, separately: the two are never joined.
 */

export interface ContactValues {
  name: string;
  email: string;
  message: string;
}

export type ContactField = keyof ContactValues;

/** One message per field, as the server or the browser words it. */
export type FieldErrors = Partial<Record<ContactField, string>>;

export const LIMITS = {
  nameMax: 100,
  emailMax: 254,
  messageMin: 10,
  messageMax: 4000,
} as const;

export type SendResult =
  | { kind: "sent" }
  | { kind: "invalid"; errors: FieldErrors }
  | { kind: "rate_limited" }
  | { kind: "failed" };

const FIELDS: ContactField[] = ["name", "email", "message"];

// Line breaks and control characters, which a name or address may not hold.
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/;
const EMAIL = /^[^\s@,<>]+@[^\s@,<>]+\.[^\s@,<>]+$/;

/** The same checks the server makes, so a mistake is caught before a request. The server stays the authority. */
export function validate(values: ContactValues): FieldErrors {
  const errors: FieldErrors = {};
  const name = values.name.trim();
  const email = values.email.trim();
  const message = values.message.trim();

  if (!name) errors.name = "Enter your name.";
  else if (name.length > LIMITS.nameMax)
    errors.name = `Use at most ${LIMITS.nameMax} characters for your name.`;
  else if (CONTROL.test(name))
    errors.name = "Your name cannot contain line breaks or control codes.";

  if (!email) errors.email = "Enter your email address.";
  else if (
    email.length > LIMITS.emailMax ||
    CONTROL.test(email) ||
    !EMAIL.test(email)
  )
    errors.email = "Enter a valid email address, like name@example.com.";

  if (message.length < LIMITS.messageMin)
    errors.message = `Write at least ${LIMITS.messageMin} characters.`;
  else if (message.length > LIMITS.messageMax)
    errors.message = `Keep your message to ${LIMITS.messageMax} characters or fewer.`;

  return errors;
}

function fieldErrorsFrom(body: unknown): FieldErrors | null {
  if (typeof body !== "object" || body === null || !("errors" in body))
    return null;
  const raw = body.errors;
  if (typeof raw !== "object" || raw === null) return null;
  const errors: FieldErrors = {};
  for (const field of FIELDS) {
    const text = (raw as Record<string, unknown>)[field];
    if (typeof text === "string" && text) errors[field] = text;
  }
  return Object.keys(errors).length > 0 ? errors : null;
}

/**
 * Send the message. Never throws: every outcome is a `SendResult`.
 * `trap` is the honeypot's value, sent as it is (people leave it empty).
 */
export async function sendMessage(
  values: ContactValues,
  trap: string,
): Promise<SendResult> {
  let response: Response;
  try {
    response = await fetch("/api/v1/contact", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: values.name,
        email: values.email,
        message: values.message,
        website: trap,
      }),
      credentials: "omit",
    });
  } catch {
    return { kind: "failed" };
  }
  if (response.status === 201) return { kind: "sent" };
  if (response.status === 429) return { kind: "rate_limited" };
  if (response.status === 422) {
    const errors = fieldErrorsFrom(await response.json().catch(() => null));
    return errors ? { kind: "invalid", errors } : { kind: "failed" };
  }
  return { kind: "failed" };
}
