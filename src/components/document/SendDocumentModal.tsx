import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, Send } from 'lucide-react';
import Modal from '../ui/Modal';
import { sendDocumentEmail } from '../../lib/documents-db';
import { buildDocumentEmailPreview } from '../../lib/document-email-preview';
import type { Document } from '../../lib/types';

export default function SendDocumentModal({
  open,
  document,
  onClose,
  onSent,
}: {
  open: boolean;
  document: Document;
  onClose: () => void;
  onSent: (result: { email_status: 'sent' | 'skipped' }) => void;
}) {
  const [step, setStep] = useState<'edit' | 'confirm'>('edit');
  const [name, setName] = useState(document.recipient_name);
  const [email, setEmail] = useState(document.recipient_email);
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');

  const emailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
  const resend = document.status !== 'draft';

  useEffect(() => {
    if (!open) return;
    setStep('edit');
    setName(document.recipient_name || '');
    setEmail(document.recipient_email || '');
    setMessage('');
    setError('');
  }, [open, document.recipient_name, document.recipient_email]);

  const emailPreview = useMemo(
    () =>
      buildDocumentEmailPreview({
        documentTitle: document.title,
        recipientName: name,
        message,
        validUntil: document.valid_until ?? null,
        logoUrl: `${window.location.origin}/favicon.png`,
      }),
    [document.title, document.valid_until, name, message],
  );

  const handleSend = async () => {
    if (!emailValid || sending) return;
    setSending(true);
    setError('');
    try {
      const result = await sendDocumentEmail({
        document_id: document.id,
        recipient_email: email.trim(),
        recipient_name: name.trim(),
        message: message.trim() || undefined,
      });
      onSent(result);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to send document');
    } finally {
      setSending(false);
    }
  };

  return (
    <Modal
      open={open}
      title={resend ? 'Resend document' : 'Send document to sign'}
      onClose={() => !sending && onClose()}
      className={step === 'confirm' ? 'max-w-2xl' : 'max-w-lg'}
    >
      {step === 'edit' ? (
        <div className="space-y-4 p-5">
          <div>
            <label className="block text-xs font-medium text-gray-600">Recipient name</label>
            <input
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="Full name"
              className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-brand-primary focus:outline-none focus:ring-1 focus:ring-brand-primary/20"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600">Recipient email</label>
            <input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="name@example.com"
              className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-brand-primary focus:outline-none focus:ring-1 focus:ring-brand-primary/20"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600">Personal note (optional)</label>
            <textarea
              value={message}
              onChange={e => setMessage(e.target.value)}
              rows={3}
              placeholder="Add a short message shown in the email…"
              className="mt-1 w-full resize-none rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-brand-primary focus:outline-none focus:ring-1 focus:ring-brand-primary/20"
            />
          </div>
          {error && <div className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600">{error}</div>}
          <div className="flex items-center justify-end gap-2 pt-1">
            <button type="button" onClick={onClose} disabled={sending} className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50">Cancel</button>
            <button
              type="button"
              onClick={() => { setError(''); if (!emailValid) { setError('Please enter a valid email address.'); return; } setStep('confirm'); }}
              disabled={!emailValid}
              className="rounded-lg gradient-bg px-4 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50"
            >
              Continue
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-4 p-5">
          <p className="text-sm text-gray-700">
            {resend ? "You're about to resend this document to:" : "You're about to send this document to:"}
          </p>
          <div className="rounded-lg border border-gray-200 bg-gray-50 px-4 py-3">
            <p className="text-sm font-semibold text-gray-900">{name.trim() || 'No name provided'}</p>
            <p className="text-sm text-gray-600">{email.trim()}</p>
          </div>

          <div>
            <p className="mb-1.5 text-xs font-medium text-gray-500">Email preview</p>
            <div className="overflow-hidden rounded-lg border border-gray-200">
              <div className="border-b border-gray-200 bg-gray-50 px-3 py-2 text-xs text-gray-500">
                <span className="font-medium text-gray-700">Subject:</span> {emailPreview.subject}
              </div>
              <iframe
                title="Email preview"
                srcDoc={emailPreview.html}
                sandbox=""
                className="h-[320px] w-full bg-white"
              />
            </div>
          </div>

          {!resend && (
            <p className="rounded-lg bg-gray-50 px-3 py-2.5 text-xs leading-relaxed text-gray-500">
              Sending makes the document live: the recipient gets a personal signing link.
            </p>
          )}
          {error && <div className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600">{error}</div>}
          <div className="flex items-center justify-between gap-2 border-t border-gray-100 pt-4">
            <button
              type="button"
              disabled={sending}
              onClick={() => setStep('edit')}
              className="inline-flex items-center gap-1.5 text-sm font-medium leading-none text-gray-600 hover:text-gray-800 disabled:opacity-50"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              Back
            </button>
            <div className="flex items-center gap-2">
              <button type="button" onClick={onClose} disabled={sending} className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50">Cancel</button>
              <button
                type="button"
                onClick={handleSend}
                disabled={!emailValid || sending}
                className="inline-flex items-center gap-2 rounded-lg gradient-bg px-4 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50"
              >
                <Send className="h-3.5 w-3.5" />
                {sending ? 'Sending…' : resend ? 'Confirm & resend' : 'Confirm & send'}
              </button>
            </div>
          </div>
        </div>
      )}
    </Modal>
  );
}
