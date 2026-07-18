import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Ban, Copy, ExternalLink, Pencil, Printer, RotateCcw, Send } from 'lucide-react';
import TopBar from '../components/layout/TopBar';
import { RichAuditContent } from '../components/ui/RichAuditText';
import { useToast } from '../components/ui/Toast';
import { useDocumentData } from '../hooks/useDocumentData';
import { markDocumentSent, updateDocument, voidDocument, reopenDocument } from '../lib/documents-db';
import { buildDocumentSnapshot, applyDocumentEdits, type DocEditPayload } from '../lib/document-agent';
import { publicProposalOrigin } from '../lib/public-origin';
import { DocumentAgentProvider } from '../components/document/agent/DocumentAgentContext';
import { DocumentAgentLayout, DocAgentToggleButton } from '../components/document/agent/DocumentAgentLayout';
import DocumentActivityTimeline from '../components/document/DocumentActivityTimeline';
import SendDocumentModal from '../components/document/SendDocumentModal';
import Modal from '../components/ui/Modal';
import type { Document, DocumentDisplayStatus, DocumentEvent } from '../lib/types';

const STATUS_LABELS: Record<DocumentDisplayStatus, { label: string; tone: string }> = {
  draft: { label: 'Draft', tone: 'bg-gray-100 text-gray-600' },
  sent: { label: 'Sent', tone: 'bg-blue-50 text-blue-600' },
  viewed: { label: 'Viewed', tone: 'bg-purple-50 text-purple-600' },
  signed: { label: 'Signed', tone: 'bg-emerald-50 text-emerald-600' },
  void: { label: 'Void', tone: 'bg-red-50 text-red-600' },
  expired: { label: 'Expired', tone: 'bg-amber-50 text-amber-700' },
};

function displayStatus(doc: Document): DocumentDisplayStatus {
  if ((doc.status === 'sent' || doc.status === 'viewed') && doc.valid_until) {
    const until = new Date(`${doc.valid_until}T23:59:59`);
    if (Number.isFinite(until.getTime()) && until < new Date()) return 'expired';
  }
  return doc.status;
}

function DetailInner({ doc, events, reload, onDocChange }: { doc: Document; events: DocumentEvent[]; reload: () => Promise<void>; onDocChange: (d: Document) => void }) {
  const navigate = useNavigate();
  const toast = useToast();
  const [sendOpen, setSendOpen] = useState(false);
  const [voidOpen, setVoidOpen] = useState(false);
  const [name, setName] = useState(doc.recipient_name);
  const [email, setEmail] = useState(doc.recipient_email);
  const [savingRecipient, setSavingRecipient] = useState(false);

  const status = displayStatus(doc);
  const locked = doc.status === 'signed' || doc.status === 'void';

  const copyLink = async () => {
    try {
      const updated = doc.public_token ? doc : await markDocumentSent(doc);
      if (!doc.public_token) { onDocChange(updated); void reload(); }
      await navigator.clipboard.writeText(`${publicProposalOrigin()}/document/${updated.public_token}`);
      toast('Signing link copied to clipboard');
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not copy link');
    }
  };

  const openRecipientView = async () => {
    const updated = doc.public_token ? doc : await markDocumentSent(doc).catch(() => null);
    if (updated?.public_token) {
      if (!doc.public_token) { onDocChange(updated); void reload(); }
      window.open(`${publicProposalOrigin()}/document/${updated.public_token}`, '_blank', 'noopener');
    }
  };

  const saveRecipient = async () => {
    setSavingRecipient(true);
    try {
      const updated = await updateDocument(doc.id, { recipient_name: name.trim(), recipient_email: email.trim() });
      onDocChange(updated);
      toast('Recipient saved');
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not save recipient');
    } finally {
      setSavingRecipient(false);
    }
  };

  return (
    <DocumentAgentProvider
      config={{
        documentId: doc.id,
        getSnapshot: () => buildDocumentSnapshot(doc),
        onApplyEdits: async (edits: DocEditPayload) => { await applyDocumentEdits(doc, edits); await reload(); },
      }}
    >
      <DocumentAgentLayout>
        <div>
          <TopBar
            title={doc.title || 'Untitled document'}
            subtitle={`DOC-${String(doc.document_number).padStart(4, '0')}`}
            actions={
              <div className="flex items-center gap-2">
                <button onClick={() => navigate('/documents')} className="flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-2 text-sm font-medium text-gray-600 hover:bg-gray-50"><ArrowLeft className="h-4 w-4" /> Back</button>
                <DocAgentToggleButton />
              </div>
            }
          />

          <div className="mx-auto flex max-w-[1200px] flex-col gap-6 p-6 lg:flex-row print:block">
            {/* Document preview */}
            <div className="min-w-0 flex-1 print:w-full">
              <div className="rounded-2xl border border-gray-100 bg-white p-8 shadow-sm">
                <h1 className="text-2xl font-bold text-gray-900">{doc.title || 'Untitled document'}</h1>
                <div className="mt-4 text-sm leading-relaxed text-gray-700 [&_ul]:list-disc [&_ul]:pl-5">
                  {doc.content.trim() ? (
                    <RichAuditContent text={doc.content} autoTagEntities={false} />
                  ) : (
                    <p className="italic text-gray-400">This document has no content yet. Edit it or use the AI assistant.</p>
                  )}
                </div>
              </div>
            </div>

            {/* Sidebar */}
            <aside className="w-full shrink-0 space-y-4 lg:w-80 print:hidden">
              <div className="rounded-xl bg-white p-5 card-shadow">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-gray-900">Status</h3>
                  <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${STATUS_LABELS[status].tone}`}>{STATUS_LABELS[status].label}</span>
                </div>
              </div>

              <div className="rounded-xl bg-white p-5 card-shadow">
                <h3 className="text-sm font-semibold text-gray-900">Recipient</h3>
                <input value={name} onChange={e => setName(e.target.value)} disabled={locked} placeholder="Recipient name" className="mt-2 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm disabled:bg-gray-50 focus:border-brand-primary focus:outline-none" />
                <input value={email} onChange={e => setEmail(e.target.value)} disabled={locked} placeholder="recipient@example.com" className="mt-2 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm disabled:bg-gray-50 focus:border-brand-primary focus:outline-none" />
                {!locked && (name !== doc.recipient_name || email !== doc.recipient_email) && (
                  <button onClick={saveRecipient} disabled={savingRecipient} className="mt-2 rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50">{savingRecipient ? 'Saving…' : 'Save recipient'}</button>
                )}
              </div>

              <div className="rounded-xl bg-white p-5 card-shadow space-y-2">
                <h3 className="mb-1 text-sm font-semibold text-gray-900">Actions</h3>
                {!locked && (
                  <button onClick={() => navigate(`/documents/${doc.id}/edit`)} className="flex w-full items-center gap-2 rounded-lg border border-gray-200 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"><Pencil className="h-4 w-4" /> Edit</button>
                )}
                {!locked && (
                  <button onClick={() => setSendOpen(true)} className="flex w-full items-center gap-2 rounded-lg gradient-bg px-3 py-2 text-sm font-semibold text-white hover:opacity-90"><Send className="h-4 w-4" /> {doc.status === 'draft' ? 'Send to sign' : 'Resend'}</button>
                )}
                {!locked && (
                  <button onClick={copyLink} className="flex w-full items-center gap-2 rounded-lg border border-gray-200 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"><Copy className="h-4 w-4" /> Copy signing link</button>
                )}
                <button onClick={openRecipientView} className="flex w-full items-center gap-2 rounded-lg border border-gray-200 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"><ExternalLink className="h-4 w-4" /> Open recipient view</button>
                <button onClick={() => window.print()} className="flex w-full items-center gap-2 rounded-lg border border-gray-200 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"><Printer className="h-4 w-4" /> Download PDF</button>
                {doc.status !== 'signed' && doc.status !== 'void' && (
                  <button onClick={() => setVoidOpen(true)} className="flex w-full items-center gap-2 rounded-lg border border-gray-200 px-3 py-2 text-sm font-medium text-red-600 hover:bg-red-50"><Ban className="h-4 w-4" /> Void</button>
                )}
                {doc.status === 'void' && (
                  <button onClick={async () => { const u = await reopenDocument(doc.id); onDocChange(u); void reload(); }} className="flex w-full items-center gap-2 rounded-lg border border-gray-200 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"><RotateCcw className="h-4 w-4" /> Reopen</button>
                )}
              </div>

              <div className="rounded-xl bg-white p-5 card-shadow">
                <h3 className="mb-3 text-sm font-semibold text-gray-900">Activity</h3>
                <DocumentActivityTimeline events={events} />
              </div>
            </aside>
          </div>

          {sendOpen && (
            <SendDocumentModal
              open={sendOpen}
              document={doc}
              onClose={() => setSendOpen(false)}
              onSent={result => { setSendOpen(false); toast(result.email_status === 'sent' ? 'Document emailed to the recipient' : 'Document is live. Email is not configured, copy the link and send it yourself.'); void reload(); }}
            />
          )}
          <Modal open={voidOpen} title="Void this document?" onClose={() => setVoidOpen(false)} className="max-w-md">
            <div className="p-5">
              <p className="text-sm text-gray-700">Voiding stops the recipient from signing. You can reopen it later.</p>
              <div className="mt-5 flex justify-end gap-2">
                <button onClick={() => setVoidOpen(false)} className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50">Cancel</button>
                <button onClick={async () => { const u = await voidDocument(doc.id); onDocChange(u); setVoidOpen(false); void reload(); }} className="rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700">Void document</button>
              </div>
            </div>
          </Modal>
        </div>
      </DocumentAgentLayout>
    </DocumentAgentProvider>
  );
}

export default function DocumentDetail() {
  const { id } = useParams<{ id: string }>();
  const { data, loading, loadError, reload, setData } = useDocumentData(id);

  if (loading) return <div className="p-8 text-sm text-gray-400">Loading…</div>;
  if (loadError || !data) return <div className="p-8 text-sm text-red-600">{loadError ?? 'Document not found'}</div>;

  return (
    <DetailInner
      key={data.document.id}
      doc={data.document}
      events={data.events}
      reload={reload}
      onDocChange={d => setData(prev => (prev ? { ...prev, document: d } : prev))}
    />
  );
}
