import { useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Check, Loader2 } from 'lucide-react';
import { RichAuditContent } from '../components/ui/RichAuditText';
import SignaturePad, { type SignaturePadHandle } from '../components/proposal/SignaturePad';
import { fetchPublicDocument, signDocumentPublic, type PublicDocumentPayload } from '../lib/documents-db';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-[#f4f4f8] py-8 px-4">
      <div className="mx-auto max-w-3xl">
        <div className="mb-5 flex items-center gap-2">
          <img src="/cropped-favicon-192x192.webp" alt="" className="h-7 w-7 rounded-md" width={28} height={28} />
          <span className="text-xs font-bold uppercase tracking-wider text-brand-primary">ECD Digital Strategy</span>
        </div>
        {children}
      </div>
    </div>
  );
}

function SignForm({ recipientName, onSign }: { recipientName: string; onSign: (typedName: string, email: string, image: string) => Promise<void> }) {
  const padRef = useRef<SignaturePadHandle>(null);
  const [name, setName] = useState(recipientName);
  const [email, setEmail] = useState('');
  const [empty, setEmpty] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const submit = async () => {
    setError('');
    if (!name.trim()) return setError('Please enter your full name.');
    if (!EMAIL_RE.test(email.trim())) return setError('Please enter a valid email.');
    const image = padRef.current?.toDataURL();
    if (!image) return setError('Please add your signature.');
    setSubmitting(true);
    try {
      await onSign(name.trim(), email.trim(), image);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not submit your signature.');
      setSubmitting(false);
    }
  };

  return (
    <div className="mt-6 rounded-2xl border border-gray-100 bg-white p-6 shadow-sm">
      <h2 className="text-lg font-bold text-gray-900">Sign this document</h2>
      <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <input value={name} onChange={e => setName(e.target.value)} placeholder="Full name" className="rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-brand-primary focus:outline-none" />
        <input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="Email" className="rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-brand-primary focus:outline-none" />
      </div>
      <div className="mt-3">
        <label className="mb-1 block text-xs font-medium text-gray-500">Signature</label>
        <SignaturePad ref={padRef} onChange={setEmpty} />
      </div>
      {error && <div className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600">{error}</div>}
      <button onClick={submit} disabled={submitting || empty} className="mt-4 w-full rounded-lg bg-brand-primary px-4 py-2.5 text-sm font-semibold text-white hover:bg-brand-primary-dark disabled:opacity-50">
        {submitting ? 'Submitting…' : 'Accept & sign'}
      </button>
    </div>
  );
}

export default function PublicDocument() {
  const { token } = useParams<{ token: string }>();
  const [payload, setPayload] = useState<PublicDocumentPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  const load = async () => {
    if (!token) return;
    const data = await fetchPublicDocument(token);
    if (!data) setNotFound(true);
    else setPayload(data);
    setLoading(false);
  };

  useEffect(() => { void load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [token]);

  if (loading) {
    return <Shell><div className="flex items-center gap-2 text-sm text-gray-400"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div></Shell>;
  }
  if (notFound || !payload) {
    return <Shell><div className="rounded-2xl border border-gray-100 bg-white p-8 text-center text-sm text-gray-500">This document link is invalid or is no longer available.</div></Shell>;
  }

  const { document, signed, expired } = payload;

  return (
    <Shell>
      <div className="rounded-2xl border border-gray-100 bg-white p-8 shadow-sm">
        <h1 className="text-2xl font-bold text-gray-900">{document.title || 'Document'}</h1>
        <div className="mt-4 text-sm leading-relaxed text-gray-700 [&_ul]:list-disc [&_ul]:pl-5">
          <RichAuditContent text={document.content} autoTagEntities={false} />
        </div>
      </div>

      {signed ? (
        <div className="mt-6 flex items-center gap-2 rounded-2xl border border-emerald-100 bg-emerald-50 p-6 text-sm font-medium text-emerald-700">
          <Check className="h-5 w-5" /> This document has been signed. Thank you.
        </div>
      ) : expired ? (
        <div className="mt-6 rounded-2xl border border-amber-100 bg-amber-50 p-6 text-sm text-amber-700">This document has expired and can no longer be signed.</div>
      ) : (
        <SignForm
          recipientName={document.recipient_name}
          onSign={async (typedName, email, image) => {
            const res = await signDocumentPublic({ token: token!, typed_name: typedName, signer_email: email, signature_image: image });
            if (!res.ok) throw new Error(res.message ?? 'Could not sign the document.');
            await load();
          }}
        />
      )}
    </Shell>
  );
}
