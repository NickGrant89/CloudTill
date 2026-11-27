/** Customer SMS for phone-order pay links. Per business, stored in Settings. */

export const TEXT_PAY_MESSAGE_KEY = "textpay.message";

export const TEXT_PAY_MESSAGE_MAX = 320;

/** Same wording shops already send, with the pay link filled in at {link}. */
export const DEFAULT_TEXT_PAY_MESSAGE = "{store}: pay {amount} securely {link}";

export function renderTextPayMessage(
  template: string | null | undefined,
  vars: { store: string; amount: string; link: string; name?: string }
): string {
  const source = (template ?? "").trim() || DEFAULT_TEXT_PAY_MESSAGE;
  const name = (vars.name ?? "").trim();
  let body = source
    .split("{store}")
    .join(vars.store.trim() || "Your shop")
    .split("{amount}")
    .join(vars.amount)
    .split("{name}")
    .join(name)
    .split("{link}")
    .join(vars.link);
  if (vars.link && !body.includes(vars.link)) {
    body = `${body.trim()}\n${vars.link}`;
  }
  return body
    .replace(/[ \t]{2,}/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
