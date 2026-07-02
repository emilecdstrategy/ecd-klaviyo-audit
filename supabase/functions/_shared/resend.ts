// Thin Resend API wrapper. Email is optional infrastructure: when
// RESEND_API_KEY is not configured, sendEmail reports `skipped` so callers
// can proceed (e.g. mark a proposal sent and hand back the link).

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

export function resendConfigured(): boolean {
  return Boolean((Deno.env.get("RESEND_API_KEY") ?? "").trim());
}

export async function sendEmail(input: SendEmailInput): Promise<SendEmailResult> {
  const apiKey = (Deno.env.get("RESEND_API_KEY") ?? "").trim();
  if (!apiKey) return { status: "skipped", reason: "RESEND_API_KEY not configured" };
  if (input.to.length === 0) return { status: "skipped", reason: "No recipients" };

  const from = input.from?.trim() || "ECD Digital Strategy <onboarding@resend.dev>";

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        from,
        to: input.to,
        subject: input.subject,
        html: input.html,
        ...(input.replyTo ? { reply_to: input.replyTo } : {}),
      }),
    });
    const body = (await res.json().catch(() => null)) as { id?: string; message?: string } | null;
    if (!res.ok) {
      return { status: "failed", reason: body?.message ?? `Resend error ${res.status}` };
    }
    return { status: "sent", id: body?.id ?? "" };
  } catch (e) {
    return { status: "failed", reason: e instanceof Error ? e.message : "Network error" };
  }
}

type EmailSettings = {
  from_name?: string | null;
  from_email?: string | null;
  reply_to?: string | null;
  team_notification_emails?: string[];
};

export function resolveFromAddress(settings: EmailSettings | null | undefined): string | undefined {
  const email = settings?.from_email?.trim();
  if (!email) return undefined;
  const name = settings?.from_name?.trim();
  return name ? `${name} <${email}>` : email;
}

/** Minimal branded HTML shell for proposal emails; the raw URL is always included as text fallback. */
export function proposalEmailHtml(options: {
  heading: string;
  bodyLines: string[];
  ctaLabel?: string;
  ctaUrl?: string;
}): string {
  const { heading, bodyLines, ctaLabel, ctaUrl } = options;
  return `<!doctype html>
<html>
  <body style="margin:0;padding:0;background:#f4f4f8;font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
    <div style="max-width:560px;margin:0 auto;padding:32px 20px;">
      <div style="background:#ffffff;border-radius:16px;padding:32px;border:1px solid #ececf3;">
        <p style="margin:0 0 4px;font-size:12px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:#4b3afe;">ECD Digital Strategy</p>
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
