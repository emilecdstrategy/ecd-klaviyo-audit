import { useState } from 'react';
import Modal from '../ui/Modal';
import { sendDocumentEmail } from '../../lib/documents-db';
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
  const [name, setName] = useState(document.recipient_name);
  const [email, setEmail] = useState(document.recipient_email);
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');

  const emailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());

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

  const resend = document.status !== 'draft';

  return (
    <Modal open={open} title={resend ? 'Resend document' : 'Send document to sign'} onClose={() => !sending && onClose()} className="max-w-lg">
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
          <button type="button" onClick={handleSend} disabled={!emailValid || sending} className="rounded-lg bg-brand-primary px-4 py-2 text-sm font-semibold text-white hover:bg-brand-primary-dark disabled:opacity-50">
            {sending ? 'Sending…' : resend ? 'Resend' : 'Send'}
          </button>
        </div>
      </div>
    </Modal>
  );
}
