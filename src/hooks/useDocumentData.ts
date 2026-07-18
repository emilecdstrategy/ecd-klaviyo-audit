import { useCallback, useEffect, useState } from 'react';
import { getDocument, listDocumentEvents, listDocumentSignatures } from '../lib/documents-db';
import type { Document, DocumentEvent, DocumentSignature } from '../lib/types';

export interface DocumentBundle {
  document: Document;
  events: DocumentEvent[];
  signature: DocumentSignature | null;
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
      setData({ document, events, signature: signatures[0] ?? null });
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
