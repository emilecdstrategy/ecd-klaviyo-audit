import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, ChevronDown, Plus, Send, X } from 'lucide-react';
import Modal from '../ui/Modal';
import { sendDocumentEmail, getDocumentSettings } from '../../lib/documents-db';
import { listAdminProfiles } from '../../lib/db';
import { buildDocumentEmailPreview } from '../../lib/document-email-preview';
import type { Document, Profile } from '../../lib/types';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Sane fallback reply-to team if no reply-to is configured in settings. */
const DEFAULT_REPLY_TO_EMAILS = ['xiomara@ecdigitalstrategy.com', 'zak@ecdigitalstrategy.com'];

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
  const [admins, setAdmins] = useState<Profile[]>([]);
  const [replyToEmails, setReplyToEmails] = useState<string[]>(DEFAULT_REPLY_TO_EMAILS);
  const [addMenuOpen, setAddMenuOpen] = useState(false);
  const [manualReplyTo, setManualReplyTo] = useState('');
  const [replyToError, setReplyToError] = useState('');

  const emailValid = EMAIL_RE.test(email.trim());
  const resend = document.status !== 'draft';

  useEffect(() => {
    if (!open) return;
    setStep('edit');
    setName(document.recipient_name || '');
    setEmail(document.recipient_email || '');
    setMessage('');
    setError('');
    setAddMenuOpen(false);
    setManualReplyTo('');
    setReplyToError('');
    listAdminProfiles().then(setAdmins).catch(() => setAdmins([]));
    getDocumentSettings()
      .then(s => {
        const seed = (s.email.reply_to || '')
          .split(',')
          .map(e => e.trim())
          .filter(e => EMAIL_RE.test(e));
        setReplyToEmails(seed.length ? seed : DEFAULT_REPLY_TO_EMAILS);
      })
      .catch(() => setReplyToEmails(DEFAULT_REPLY_TO_EMAILS));
  }, [open, document.recipient_name, document.recipient_email]);

  const nameForReplyTo = (e: string) => admins.find(a => a.email.toLowerCase() === e.toLowerCase())?.name || e;
  const addableAdmins = admins.filter(a => a.email && !replyToEmails.some(e => e.toLowerCase() === a.email.toLowerCase()));

  const addReplyTo = (e: string) => {
    const trimmed = e.trim();
    if (!trimmed) return;
    setReplyToEmails(prev => (prev.some(x => x.toLowerCase() === trimmed.toLowerCase()) ? prev : [...prev, trimmed]));
  };
  const addManualReplyTo = () => {
    const trimmed = manualReplyTo.trim();
    if (!EMAIL_RE.test(trimmed)) { setReplyToError('Please enter a valid email address.'); return; }
    addReplyTo(trimmed);
    setManualReplyTo('');
    setReplyToError('');
    setAddMenuOpen(false);
  };
  const removeReplyTo = (e: string) => setReplyToEmails(prev => prev.filter(x => x !== e));

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
        reply_to_emails: replyToEmails,
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
            <p className="mb-1.5 text-xs font-medium text-gray-500">
              Replies will go to{replyToEmails.length > 1 ? ' (first as Reply-To, rest CC’d)' : ''}
            </p>
            <div className="flex flex-wrap items-center gap-1.5">
              {replyToEmails.map(e => (
                <span key={e} className="inline-flex items-center gap-1 rounded-full bg-brand-primary/10 py-1 pl-2.5 pr-1.5 text-xs font-medium text-brand-primary">
                  {nameForReplyTo(e)}
                  <button type="button" onClick={() => removeReplyTo(e)} className="rounded-full p-0.5 hover:bg-brand-primary/20" aria-label={`Remove ${e}`}>
                    <X className="h-3 w-3" />
                  </button>
                </span>
              ))}
              {replyToEmails.length === 0 && (
                <span className="text-xs text-gray-400">No one selected. Replies go straight to the recipient's inbox.</span>
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
                      <button type="button" onClick={addManualReplyTo} className="shrink-0 rounded-md bg-brand-primary px-2 py-1 text-xs font-medium text-white hover:opacity-90">
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
