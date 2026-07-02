// SMTP mail sender (Gmail by default). Email is optional infrastructure: when
// SMTP_USER/SMTP_PASS are not configured, sendEmail reports `skipped` so
// callers can proceed (e.g. mark a proposal sent and hand back the link).
import { SMTPClient } from "https://deno.land/x/denomailer@1.6.0/mod.ts";

export type SendEmailInput = {
  to: string[];
  subject: string;
  html: string;
  from?: string;
  replyTo?: string;
};

export type SendEmailResult =
  | { status: "sent"; id: string }
  | { status: "skipped"; reason: string }
  | { status: "failed"; reason: string };

export function mailerConfigured(): boolean {
  return Boolean((Deno.env.get("SMTP_USER") ?? "").trim() && (Deno.env.get("SMTP_PASS") ?? "").trim());
}

export async function sendEmail(input: SendEmailInput): Promise<SendEmailResult> {
  const host = (Deno.env.get("SMTP_HOST") ?? "smtp.gmail.com").trim();
  const port = Number(Deno.env.get("SMTP_PORT") ?? "587");
  const user = (Deno.env.get("SMTP_USER") ?? "").trim();
  const pass = (Deno.env.get("SMTP_PASS") ?? "").trim();

  if (!user || !pass) return { status: "skipped", reason: "SMTP not configured" };
  if (input.to.length === 0) return { status: "skipped", reason: "No recipients" };

  let client: SMTPClient;
  try {
    client = new SMTPClient({
      connection: {
        hostname: host,
        port,
        tls: port === 465,
        auth: { username: user, password: pass },
      },
    });
  } catch (e) {
    return { status: "failed", reason: e instanceof Error ? e.message : "SMTP client init failed" };
  }

  try {
    await client.send({
      from: input.from?.trim() || `ECD Digital Strategy <${user}>`,
      to: input.to,
      subject: input.subject,
      html: input.html,
      content: "This email requires an HTML-capable mail client to view.",
      ...(input.replyTo ? { replyTo: input.replyTo } : {}),
    });
    return { status: "sent", id: crypto.randomUUID() };
  } catch (e) {
    return { status: "failed", reason: e instanceof Error ? e.message : "SMTP send failed" };
  } finally {
    try {
      await client.close();
    } catch {
      // Connection may already be closed; nothing to do.
    }
  }
}

type EmailSettings = {
  from_name?: string | null;
  from_email?: string | null;
  reply_to?: string | null;
  team_notification_emails?: string[];
};

export function resolveFromAddress(settings: EmailSettings | null | undefined): string | undefined {
  const configuredAccount = (Deno.env.get("SMTP_USER") ?? "").trim();
  const email = settings?.from_email?.trim() || configuredAccount;
  if (!email) return undefined;
  const name = settings?.from_name?.trim() || "ECD Digital Strategy";
  return `${name} <${email}>`;
}

/** Branded HTML shell for proposal emails, with the ECD icon in the header and the raw URL as a text fallback. */
export function proposalEmailHtml(options: {
  heading: string;
  bodyLines: string[];
  ctaLabel?: string;
  ctaUrl?: string;
  logoUrl?: string;
}): string {
  const { heading, bodyLines, ctaLabel, ctaUrl, logoUrl } = options;
  return `<!doctype html>
<html>
  <body style="margin:0;padding:0;background:#f4f4f8;font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
    <div style="max-width:560px;margin:0 auto;padding:32px 20px;">
      <div style="background:#ffffff;border-radius:16px;padding:32px;border:1px solid #ececf3;">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 18px;">
          <tr>
            ${logoUrl
              ? `<td style="vertical-align:middle;padding-right:8px;"><img src="${logoUrl}" width="26" height="26" alt="" style="display:block;border-radius:6px;" /></td>`
              : ""}
            <td style="vertical-align:middle;">
              <span style="font-size:12px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:#4b3afe;">ECD Digital Strategy</span>
            </td>
          </tr>
        </table>
        <h1 style="margin:0 0 16px;font-size:20px;color:#111827;">${heading}</h1>
        ${bodyLines.map(line => `<p style="margin:0 0 12px;font-size:14px;line-height:1.6;color:#374151;">${line}</p>`).join("")}
        ${ctaUrl && ctaLabel
          ? `<a href="${ctaUrl}" style="display:inline-block;margin-top:8px;background:#4b3afe;color:#ffffff;text-decoration:none;font-size:14px;font-weight:600;padding:12px 24px;border-radius:10px;">${ctaLabel}</a>
             <p style="margin:16px 0 0;font-size:12px;color:#9ca3af;">Or copy this link: <span style="word-break:break-all;">${ctaUrl}</span></p>`
          : ""}
      </div>
      <p style="margin:16px 0 0;text-align:center;font-size:11px;color:#9ca3af;">Sent by ECD Digital Strategy</p>
    </div>
  </body>
</html>`;
}
