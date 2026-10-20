// Branded HTML + text email bodies (SPEC M12 "Email: HTML + text, company branding").
// Templates are plain text; this wraps them in a small inline-styled layout (no
// external CSS, no images except an optional logo URL). Pure.
import { escapeHtml } from "@/lib/template";

const URL_RE = /\bhttps?:\/\/[^\s<>"]+/g;

function linkify(escaped: string, accent: string): string {
  return escaped.replace(URL_RE, (u) => {
    const clean = u.replace(/[.,;:!?)]+$/, "");
    const tail = u.slice(clean.length);
    return `<a href="${clean}" style="color:${accent};text-decoration:underline">${clean}</a>${tail}`;
  });
}

/**
 * Tidy a rendered email body: an empty optional variable ({{job.service_fee_line}})
 * must not leave trailing spaces or a run of blank lines (QA T6-13).
 */
export function tidyEmailText(s: string): string {
  return s
    .replace(/[ \t]{2,}/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export interface EmailLayoutInput {
  subject: string;
  /** Plain-text body (paragraphs separated by blank lines). */
  text: string;
  companyName: string;
  companyPhone?: string | null;
  companyAddress?: string | null;
  /** Brand accent (hex); default iOS blue. */
  accent?: string | null;
  logoUrl?: string | null;
  /** Footer line (e.g. why they got this email / how to opt out). */
  footer?: string | null;
}

/** Plain text with the company sign-off appended (the `text` part of the email). */
export function emailText(i: EmailLayoutInput): string {
  const sign = [i.companyName, i.companyPhone].filter(Boolean).join("\n");
  return `${i.text.trim()}\n\n--\n${sign}${i.footer ? `\n\n${i.footer}` : ""}\n`;
}

/** Minimal responsive HTML email. Every dynamic value is HTML-escaped. */
export function emailHtml(i: EmailLayoutInput): string {
  const accent = /^#[0-9a-f]{3,8}$/i.test(i.accent ?? "")
    ? (i.accent as string)
    : "#007aff";
  const paras = i.text
    .trim()
    .split(/\n{2,}/)
    .map(
      (p) =>
        `<p style="margin:0 0 16px;line-height:1.5">${linkify(escapeHtml(p).replace(/\n/g, "<br>"), accent)}</p>`,
    )
    .join("");
  const logo = i.logoUrl
    ? `<img src="${escapeHtml(i.logoUrl)}" alt="" height="36" style="display:block;margin:0 0 16px;max-height:36px">`
    : "";
  const meta = [i.companyPhone, i.companyAddress]
    .filter(Boolean)
    .map((x) => escapeHtml(String(x)))
    .join(" · ");
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(i.subject)}</title></head>
<body style="margin:0;padding:0;background:#f2f2f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#1c1c1e">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f2f2f7;padding:24px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:14px;padding:28px 24px">
<tr><td style="font-size:16px">${logo}<div style="font-size:13px;font-weight:600;color:${accent};margin:0 0 12px">${escapeHtml(i.companyName)}</div>${paras}</td></tr>
</table>
<div style="max-width:560px;font-size:12px;line-height:1.5;color:#8e8e93;padding:14px 8px 0;text-align:center">${meta}${i.footer ? `<br>${escapeHtml(i.footer)}` : ""}</div>
</td></tr></table></body></html>`;
}
