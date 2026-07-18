import { useCallback, useEffect, useState } from 'react';
import { getDocument, listDocumentEvents, listDocumentSignatures } from '../lib/documents-db';
import type { Document, DocumentEvent, DocumentSignature } from '../lib/types';

export interface DocumentBundle {
  document: Document;
  events: DocumentEvent[];
  /** Recipient signature (the one that drives "signed" status). */
  signature: DocumentSignature | null;
  /** Sender (staff) counter-signature. */
  senderSignature: DocumentSignature | null;
}

export function useDocumentData(id: string | undefined) {
  const [data, setData] = useState<DocumentBundle | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!id) return;
    setLoadError(null);
    try {
      const document = await getDocument(id);
      if (!document) {
        setLoadError('Document not found');
        setData(null);
        return;
      }
      const [events, signatures] = await Promise.all([listDocumentEvents(id), listDocumentSignatures(id)]);
      const signature = signatures.find(s => s.signer_role === 'recipient') ?? signatures.find(s => s.signer_role !== 'sender') ?? null;
      const senderSignature = signatures.find(s => s.signer_role === 'sender') ?? null;
      setData({ document, events, signature, senderSignature });
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : 'Failed to load document');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    setLoading(true);
    void reload();
  }, [reload]);

  return { data, setData, loading, loadError, reload };
}
