// Client-side mirror of the email that supabase/functions/document_send_email
// sends (via mailer.ts's proposalEmailHtml). Used for the live send preview.
// Keep the body lines + subject in sync with document_send_email/index.ts.

import { emailShellHtml, escapeHtml } from './proposal-email-preview';

export function buildDocumentEmailPreview(options: {
  documentTitle: string;
  recipientName: string;
  message: string;
  validUntil: string | null;
  logoUrl?: string;
}): { subject: string; html: string } {
  const { documentTitle, recipientName, message, validUntil, logoUrl } = options;
  const title = documentTitle.trim() || 'Untitled';
  const firstName = recipientName.trim().split(' ')[0] || '';
  const bodyLines = [
    `Hi${firstName ? ` ${escapeHtml(firstName)}` : ''},`,
    ...(message.trim() ? [escapeHtml(message.trim())] : []),
    `Please review the document "${escapeHtml(title)}" and sign it directly from the link below.`,
    ...(validUntil ? [`This document is available to sign until ${escapeHtml(validUntil)}.`] : []),
  ];

  return {
    subject: `Please review and sign: ${title}`,
    html: emailShellHtml({
      heading: 'A document is ready for your signature',
      bodyLines,
      ctaLabel: 'Review & sign',
      ctaUrl: `${window.location.origin}/document/…`,
      logoUrl,
    }),
  };
}
