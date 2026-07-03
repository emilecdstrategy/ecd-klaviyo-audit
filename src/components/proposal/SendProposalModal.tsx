import { useEffect, useState } from 'react';
import { ArrowLeft, Send } from 'lucide-react';
import Modal from '../ui/Modal';
import { sendProposalEmail } from '../../lib/proposals-db';
import { updateClient } from '../../lib/db';
import type { Client, Proposal } from '../../lib/types';

type SendProposalModalProps = {
  open: boolean;
  proposal: Proposal;
  client?: Client;
  onClose: () => void;
  onSent: (emailStatus: 'sent' | 'skipped') => void;
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function SendProposalModal({ open, proposal, client, onClose, onSent }: SendProposalModalProps) {
  const [step, setStep] = useState<'edit' | 'confirm'>('edit');
  const [recipientName, setRecipientName] = useState(proposal.recipient_name);
  const [recipientEmail, setRecipientEmail] = useState(proposal.recipient_email);
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const isResend = proposal.status !== 'draft';

  useEffect(() => {
    if (open) {
      setStep('edit');
      setRecipientName(proposal.recipient_name || client?.name || '');
      setRecipientEmail(proposal.recipient_email || client?.email || '');
      setError('');
    }
  }, [open, proposal.recipient_name, proposal.recipient_email, client?.name, client?.email]);

  const continueToConfirm = () => {
    setError('');
    if (!EMAIL_RE.test(recipientEmail.trim())) {
      setError('Please enter a valid email address.');
      return;
    }
    setStep('confirm');
  };

  const send = async () => {
    setError('');
    setSending(true);
    try {
      const result = await sendProposalEmail({
        proposal_id: proposal.id,
        recipient_email: recipientEmail.trim(),
        recipient_name: recipientName.trim(),
        message: message.trim(),
      });
      if (client && !client.email.trim() && recipientEmail.trim()) {
        try { await updateClient(client.id, { email: recipientEmail.trim() }); } catch { /* best effort */ }
      }
      onSent(result.email_status);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to send proposal');
    } finally {
      setSending(false);
    }
  };

  const noClientEmailOnFile = !client?.email;

  return (
    <Modal
      open={open}
      title={isResend ? 'Resend proposal' : 'Send proposal'}
      onClose={() => (sending ? undefined : onClose())}
      className="max-w-lg"
    >
      {step === 'edit' ? (
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
          {noClientEmailOnFile && !proposal.recipient_email && (
            <p className="text-xs text-amber-600">
              No email is on file for this client yet — the address you enter here will also be saved to their client profile.
            </p>
          )}
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
              onClick={onClose}
              className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={continueToConfirm}
              className="inline-flex items-center gap-2 rounded-lg gradient-bg px-4 py-2 text-sm font-medium text-white hover:opacity-90"
            >
              Continue
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-4 p-5">
          <p className="text-sm text-gray-700">
            {isResend ? "You're about to resend this proposal to:" : "You're about to send this proposal to:"}
          </p>
          <div className="rounded-lg border border-gray-200 bg-gray-50 px-4 py-3">
            <p className="text-sm font-semibold text-gray-900">{recipientName.trim() || 'No name provided'}</p>
            <p className="text-sm text-gray-600">{recipientEmail.trim()}</p>
          </div>
          <ul className="list-disc space-y-1 pl-5 text-xs leading-relaxed text-gray-500">
            <li>An email with a personal signing link will be sent to this address.</li>
            {!isResend && <li>The contract text is locked in and the validity window starts now.</li>}
            {noClientEmailOnFile && <li>This email will be saved to the client's profile for next time.</li>}
          </ul>
          {error && <p className="text-sm text-red-600">{error}</p>}
          <div className="flex items-center justify-between gap-2 border-t border-gray-100 pt-4">
            <button
              type="button"
              disabled={sending}
              onClick={() => setStep('edit')}
              className="inline-flex items-center gap-1.5 text-sm font-medium text-gray-600 hover:text-gray-800 disabled:opacity-50"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              Back
            </button>
            <div className="flex items-center gap-2">
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
                {sending ? 'Sending…' : isResend ? 'Confirm & resend' : 'Confirm & send'}
              </button>
            </div>
          </div>
        </div>
      )}
    </Modal>
  );
}
