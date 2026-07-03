// Client-side mirror of supabase/functions/_shared/mailer.ts's proposalEmailHtml,
// used to render an accurate live preview before the real send. Keep the two in sync.

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function proposalEmailShellHtml(options: {
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
              : ''}
            <td style="vertical-align:middle;">
              <span style="font-size:12px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:#4b3afe;">ECD Digital Strategy</span>
            </td>
          </tr>
        </table>
        <h1 style="margin:0 0 16px;font-size:20px;color:#111827;">${heading}</h1>
        ${bodyLines.map(line => `<p style="margin:0 0 12px;font-size:14px;line-height:1.6;color:#374151;">${line}</p>`).join('')}
        ${ctaUrl && ctaLabel
          ? `<a href="${ctaUrl}" style="display:inline-block;margin-top:8px;background:#4b3afe;color:#ffffff;text-decoration:none;font-size:14px;font-weight:600;padding:12px 24px;border-radius:10px;">${ctaLabel}</a>
             <p style="margin:16px 0 0;font-size:12px;color:#9ca3af;">Or copy this link: <span style="word-break:break-all;">${ctaUrl}</span></p>`
          : ''}
      </div>
      <p style="margin:16px 0 0;text-align:center;font-size:11px;color:#9ca3af;">Sent by ECD Digital Strategy</p>
    </div>
  </body>
</html>`;
}

function defaultValidUntil(): string {
  return new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

export function buildProposalEmailPreview(options: {
  recipientName: string;
  message: string;
  companyName: string;
  validUntil: string | null;
  logoUrl?: string;
}): { subject: string; html: string } {
  const { recipientName, message, companyName, validUntil, logoUrl } = options;
  const firstName = recipientName.trim().split(' ')[0] || '';
  const bodyLines = [
    `Hi${firstName ? ` ${escapeHtml(firstName)}` : ''},`,
    ...(message.trim() ? [escapeHtml(message.trim())] : []),
    `Please review the proposal we prepared for ${escapeHtml(companyName)}. You can read and sign it directly from the link below.`,
    `This proposal is valid until ${validUntil || defaultValidUntil()}.`,
  ];

  return {
    subject: `Proposal for ${companyName} from ECD Digital Strategy`,
    html: proposalEmailShellHtml({
      heading: 'Your proposal is ready',
      bodyLines,
      ctaLabel: 'View & sign proposal',
      ctaUrl: `${window.location.origin}/proposal/…`,
      logoUrl,
    }),
  };
}
