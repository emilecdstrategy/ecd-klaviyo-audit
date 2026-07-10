import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, ChevronDown, Plus, Send, X } from 'lucide-react';
import Modal from '../ui/Modal';
import { sendProposalEmail } from '../../lib/proposals-db';
import { listAdminProfiles, updateClient } from '../../lib/db';
import { buildProposalEmailPreview } from '../../lib/proposal-email-preview';
import type { Client, Profile, Proposal } from '../../lib/types';

type SendProposalModalProps = {
  open: boolean;
  proposal: Proposal;
  client?: Client;
  onClose: () => void;
  onSent: (emailStatus: 'sent' | 'skipped') => void;
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Sane baseline reply-to team even if the matching admin profiles are ever renamed or removed. */
const DEFAULT_REPLY_TO_EMAILS = ['xiomara@ecdigitalstrategy.com', 'zak@ecdigitalstrategy.com'];

export default function SendProposalModal({ open, proposal, client, onClose, onSent }: SendProposalModalProps) {
  const [step, setStep] = useState<'edit' | 'confirm'>('edit');
  const [recipientName, setRecipientName] = useState(proposal.recipient_name);
  const [recipientEmail, setRecipientEmail] = useState(proposal.recipient_email);
  const [recipient2Name, setRecipient2Name] = useState(proposal.recipient2_name);
  const [recipient2Email, setRecipient2Email] = useState(proposal.recipient2_email);
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [admins, setAdmins] = useState<Profile[]>([]);
  const [replyToEmails, setReplyToEmails] = useState<string[]>(DEFAULT_REPLY_TO_EMAILS);
  const [addMenuOpen, setAddMenuOpen] = useState(false);
  const [manualReplyTo, setManualReplyTo] = useState('');
  const [replyToError, setReplyToError] = useState('');
  const isResend = proposal.status !== 'draft';

  useEffect(() => {
    if (open) {
      setStep('edit');
      setRecipientName(proposal.recipient_name || client?.name || '');
      setRecipientEmail(proposal.recipient_email || client?.email || '');
      setRecipient2Name(proposal.recipient2_name || '');
      setRecipient2Email(proposal.recipient2_email || '');
      setError('');
      setReplyToEmails(DEFAULT_REPLY_TO_EMAILS);
      setAddMenuOpen(false);
      setManualReplyTo('');
      setReplyToError('');
      listAdminProfiles().then(setAdmins).catch(() => setAdmins([]));
    }
  }, [open, proposal.recipient_name, proposal.recipient_email, proposal.recipient2_name, proposal.recipient2_email, client?.name, client?.email]);

  const hasSecondSigner = Boolean(proposal.recipient2_email || recipient2Email.trim());

  const nameForReplyTo = (email: string) => admins.find(a => a.email.toLowerCase() === email.toLowerCase())?.name || email;
  const addableAdmins = admins.filter(a => a.email && !replyToEmails.some(e => e.toLowerCase() === a.email.toLowerCase()));

  const addReplyTo = (email: string) => {
    const trimmed = email.trim();
    if (!trimmed) return;
    setReplyToEmails(prev => (prev.some(e => e.toLowerCase() === trimmed.toLowerCase()) ? prev : [...prev, trimmed]));
  };

  const addManualReplyTo = () => {
    const trimmed = manualReplyTo.trim();
    if (!EMAIL_RE.test(trimmed)) {
      setReplyToError('Please enter a valid email address.');
      return;
    }
    addReplyTo(trimmed);
    setManualReplyTo('');
    setReplyToError('');
    setAddMenuOpen(false);
  };

  const removeReplyTo = (email: string) => {
    setReplyToEmails(prev => prev.filter(e => e !== email));
  };

  const continueToConfirm = () => {
    setError('');
    if (!EMAIL_RE.test(recipientEmail.trim())) {
      setError('Please enter a valid email address.');
      return;
    }
    if (hasSecondSigner && !EMAIL_RE.test(recipient2Email.trim())) {
      setError('Please enter a valid email address for the second signer.');
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
        ...(hasSecondSigner
          ? { recipient2_email: recipient2Email.trim(), recipient2_name: recipient2Name.trim() }
          : {}),
        message: message.trim(),
        reply_to_emails: replyToEmails,
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

  const emailPreview = useMemo(
    () =>
      buildProposalEmailPreview({
        recipientName,
        message,
        companyName: client?.company_name || proposal.client?.company_name || 'your company',
        validUntil: proposal.valid_until,
        logoUrl: `${window.location.origin}/cropped-favicon-192x192.webp`,
      }),
    [recipientName, message, client?.company_name, proposal.client?.company_name, proposal.valid_until],
  );

  return (
    <Modal
      open={open}
      title={isResend ? 'Resend proposal' : 'Send proposal'}
      onClose={() => (sending ? undefined : onClose())}
      className={step === 'confirm' ? 'max-w-2xl' : 'max-w-lg'}
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
          {hasSecondSigner && (
            <div className="rounded-lg border border-gray-100 bg-gray-50/60 p-3">
              <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-gray-400">Second signer</p>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-xs font-medium text-gray-500">Name</label>
                  <input
                    type="text"
                    value={recipient2Name}
                    onChange={e => setRecipient2Name(e.target.value)}
                    placeholder="John Smith"
                    className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-brand-primary focus:outline-none focus:ring-1 focus:ring-brand-primary/20"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-gray-500">Email</label>
                  <input
                    type="email"
                    value={recipient2Email}
                    onChange={e => setRecipient2Email(e.target.value)}
                    placeholder="john@company.com"
                    className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-brand-primary focus:outline-none focus:ring-1 focus:ring-brand-primary/20"
                  />
                </div>
              </div>
              <p className="mt-2 text-[11px] text-gray-400">
                Both signers receive their own email with a personal signing link. The proposal is won once both have signed.
              </p>
            </div>
          )}
          {noClientEmailOnFile && !proposal.recipient_email && (
            <p className="text-xs text-amber-600">
              No email is on file for this client yet. The address you enter here will also be saved to their client profile.
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
            {hasSecondSigner && (
              <div className="mt-2 border-t border-gray-200 pt-2">
                <p className="text-sm font-semibold text-gray-900">{recipient2Name.trim() || 'No name provided'}</p>
                <p className="text-sm text-gray-600">{recipient2Email.trim()}</p>
              </div>
            )}
          </div>

          <div>
            <p className="mb-1.5 text-xs font-medium text-gray-500">
              Replies will go to{replyToEmails.length > 1 ? ' (first as Reply-To, rest CC’d)' : ''}
            </p>
            <div className="flex flex-wrap items-center gap-1.5">
              {replyToEmails.map(email => (
                <span
                  key={email}
                  className="inline-flex items-center gap-1 rounded-full bg-brand-primary/10 py-1 pl-2.5 pr-1.5 text-xs font-medium text-brand-primary"
                >
                  {nameForReplyTo(email)}
                  <button
                    type="button"
                    onClick={() => removeReplyTo(email)}
                    className="rounded-full p-0.5 hover:bg-brand-primary/20"
                    aria-label={`Remove ${email}`}
                  >
                    <X className="h-3 w-3" />
                  </button>
                </span>
              ))}
              {replyToEmails.length === 0 && (
                <span className="text-xs text-gray-400">No one selected. Replies go straight to the client's inbox.</span>
              )}
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setAddMenuOpen(v => !v)}
                  className="inline-flex items-center gap-1 rounded-full border border-dashed border-gray-300 px-2.5 py-1 text-xs font-medium text-gray-500 hover:border-brand-primary hover:text-brand-primary"
                >
                  <Plus className="h-3 w-3" />
                  Add
                  <ChevronDown className="h-3 w-3" />
                </button>
                {addMenuOpen && (
                  <div className="absolute left-0 top-full z-10 mt-1.5 w-64 rounded-lg border border-gray-200 bg-white p-2 shadow-lg">
                    {addableAdmins.length > 0 && (
                      <div className="mb-2 space-y-0.5">
                        {addableAdmins.map(a => (
                          <button
                            key={a.id}
                            type="button"
                            onClick={() => { addReplyTo(a.email); setAddMenuOpen(false); }}
                            className="block w-full rounded-md px-2 py-1.5 text-left text-xs text-gray-700 hover:bg-gray-50"
                          >
                            <span className="font-medium">{a.name || a.email}</span>
                            {a.name && <span className="text-gray-400"> · {a.email}</span>}
                          </button>
                        ))}
                      </div>
                    )}
                    <div className="flex items-center gap-1.5 border-t border-gray-100 pt-2">
                      <input
                        type="email"
                        value={manualReplyTo}
                        onChange={e => setManualReplyTo(e.target.value)}
                        onKeyDown={e => { if (e.key === 'Enter') addManualReplyTo(); }}
                        placeholder="someone@else.com"
                        className="w-full rounded-md border border-gray-200 px-2 py-1 text-xs focus:border-brand-primary focus:outline-none focus:ring-1 focus:ring-brand-primary/20"
                      />
                      <button
                        type="button"
                        onClick={addManualReplyTo}
                        className="shrink-0 rounded-md bg-brand-primary px-2 py-1 text-xs font-medium text-white hover:opacity-90"
                      >
                        Add
                      </button>
                    </div>
                    {replyToError && <p className="mt-1 text-xs text-red-600">{replyToError}</p>}
                  </div>
                )}
              </div>
            </div>
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

          <ul className="list-disc space-y-1 pl-5 text-xs leading-relaxed text-gray-500">
            <li>
              {hasSecondSigner
                ? 'Each signer receives their own email with a personal signing link.'
                : 'An email with a personal signing link will be sent to this address.'}
            </li>
            {hasSecondSigner && <li>The proposal is marked won once both signers have signed.</li>}
            {!isResend && <li>The contract text is locked in and the validity window starts now.</li>}
            {noClientEmailOnFile && <li>This email will be saved to the client's profile for next time.</li>}
          </ul>
          {error && <p className="text-sm text-red-600">{error}</p>}
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
