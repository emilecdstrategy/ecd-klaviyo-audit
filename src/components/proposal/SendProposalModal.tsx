import { useEffect, useState } from 'react';
import { Send } from 'lucide-react';
import Modal from '../ui/Modal';
import { sendProposalEmail } from '../../lib/proposals-db';
import type { Proposal } from '../../lib/types';

type SendProposalModalProps = {
  open: boolean;
  proposal: Proposal;
  onClose: () => void;
  onSent: (emailStatus: 'sent' | 'skipped') => void;
};

export default function SendProposalModal({ open, proposal, onClose, onSent }: SendProposalModalProps) {
  const [recipientName, setRecipientName] = useState(proposal.recipient_name);
  const [recipientEmail, setRecipientEmail] = useState(proposal.recipient_email);
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const isResend = proposal.status !== 'draft';

  useEffect(() => {
    if (open) {
      setRecipientName(proposal.recipient_name);
      setRecipientEmail(proposal.recipient_email);
      setError('');
    }
  }, [open, proposal.recipient_name, proposal.recipient_email]);

  const send = async () => {
    setError('');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipientEmail.trim())) {
      setError('Please enter a valid email address.');
      return;
    }
    setSending(true);
    try {
      const result = await sendProposalEmail({
        proposal_id: proposal.id,
        recipient_email: recipientEmail.trim(),
        recipient_name: recipientName.trim(),
        message: message.trim(),
      });
      onSent(result.email_status);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to send proposal');
    } finally {
      setSending(false);
    }
  };

  return (
    <Modal
      open={open}
      title={isResend ? 'Resend proposal' : 'Send proposal'}
      onClose={() => (sending ? undefined : onClose())}
      className="max-w-lg"
    >
      <div className="space-y-4 p-5">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-500">Recipient name</label>
            <input
              type="text"
              value={recipientName}
              onChange={e => setRecipientName(e.target.value)}
              placeholder="Jane Smith"
              className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-brand-primary focus:outline-none focus:ring-1 focus:ring-brand-primary/20"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-500">Recipient email</label>
            <input
              type="email"
              value={recipientEmail}
              onChange={e => setRecipientEmail(e.target.value)}
              placeholder="jane@company.com"
              className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-brand-primary focus:outline-none focus:ring-1 focus:ring-brand-primary/20"
            />
          </div>
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-gray-500">Personal message (optional)</label>
          <textarea
            value={message}
            onChange={e => setMessage(e.target.value)}
            rows={3}
            placeholder="A short note included at the top of the email."
            className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-brand-primary focus:outline-none focus:ring-1 focus:ring-brand-primary/20"
          />
        </div>
        {!isResend && (
          <p className="rounded-lg bg-gray-50 px-3 py-2.5 text-xs leading-relaxed text-gray-500">
            Sending makes the proposal live: the contract text is locked in, the validity window
            starts, and the client gets a personal signing link.
          </p>
        )}
        {error && <p className="text-sm text-red-600">{error}</p>}
        <div className="flex items-center justify-end gap-2 border-t border-gray-100 pt-4">
          <button
            type="button"
            disabled={sending}
            onClick={onClose}
            className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={sending}
            onClick={send}
            className="inline-flex items-center gap-2 rounded-lg gradient-bg px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
          >
            <Send className="h-3.5 w-3.5" />
            {sending ? 'Sending…' : isResend ? 'Resend' : 'Send proposal'}
          </button>
        </div>
      </div>
    </Modal>
  );
}
