import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import AppPreloader from '../components/ui/AppPreloader';
import BrandedCheckbox from '../components/ui/BrandedCheckbox';
import ProposalDocument from '../components/proposal/ProposalDocument';
import {
  TemplateEditProvider,
  templateLineItemId,
  useProposalEdit,
} from '../components/proposal/edit/ProposalEditContext';
import { useToast } from '../components/ui/Toast';
import {
  getProposalTemplate,
  listContractDocuments,
  updateProposalTemplate,
} from '../lib/proposals-db';
import type {
  ContractDocument,
  Proposal,
  ProposalLineItem,
  ProposalTemplate,
} from '../lib/types';

/** Present a template as a proposal-shaped object so the shared editor
 * components can render it. Client, cover, signing, and status fields are
 * inert placeholders (the template variant of ProposalDocument hides them). */
function templateToProposal(t: ProposalTemplate): Proposal {
  return {
    id: t.id,
    proposal_number: 0,
    client_id: '',
    audit_id: null,
    template_id: null,
    title: t.name,
    status: 'draft',
    cover: {},
    content_blocks: t.content_blocks,
    include_contracts: t.default_contracts,
    contracts_snapshot: null,
    discount_type: t.discount_type,
    discount_value: t.discount_value,
    discount_applies_to: t.discount_applies_to,
    discount_label: t.discount_label,
    recipient_name: '',
    recipient_email: '',
    recipient2_name: '',
    recipient2_email: '',
    public_token: null,
    public_token2: null,
    valid_until: null,
    sent_at: null,
    first_viewed_at: null,
    client_signed_at: null,
    countersigned_at: null,
    won_at: null,
    lost_at: null,
    lost_reason: null,
    created_by: null,
    created_at: t.created_at,
    updated_at: t.updated_at,
  };
}

function templateToLineItems(t: ProposalTemplate): ProposalLineItem[] {
  return [...t.default_line_items]
    .sort((a, b) => a.display_order - b.display_order)
    .map(item => ({ ...item, id: templateLineItemId(), proposal_id: '', created_at: '' }));
}

function SaveStatusDot() {
  const { saveStatus } = useProposalEdit();
  const label =
    saveStatus === 'saving' ? 'Saving…' :
    saveStatus === 'saved' ? 'Saved' :
    saveStatus === 'error' ? 'Save failed' : '';
  if (!label) return null;
  return (
    <span className="flex items-center gap-1.5 text-xs text-gray-400">
      <span
        className={`h-1.5 w-1.5 rounded-full ${
          saveStatus === 'error' ? 'bg-red-500' : saveStatus === 'saving' ? 'bg-amber-400' : 'bg-emerald-500'
        }`}
      />
      {label}
    </span>
  );
}

function TemplateNameField({ name }: { name: string }) {
  const { updateTitle } = useProposalEdit();
  return (
    <input
      type="text"
      value={name}
      onChange={e => updateTitle(e.target.value)}
      placeholder="Template name"
      aria-label="Template name"
      className="min-w-0 flex-1 rounded-lg border border-transparent bg-transparent px-2 py-1 text-sm font-semibold text-gray-900 hover:border-gray-200 focus:border-brand-primary focus:bg-white focus:outline-none focus:ring-1 focus:ring-brand-primary/20"
    />
  );
}

export default function TemplateEditor() {
  const { templateId } = useParams<{ templateId: string }>();
  const toast = useToast();
  const [template, setTemplate] = useState<ProposalTemplate | null>(null);
  const [lineItems, setLineItems] = useState<ProposalLineItem[]>([]);
  const [contractDocs, setContractDocs] = useState<ContractDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');

  useEffect(() => {
    if (!templateId) return;
    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        const [t, docs] = await Promise.all([
          getProposalTemplate(templateId),
          listContractDocuments(),
        ]);
        if (cancelled) return;
        if (!t) {
          setLoadError('Template not found');
          return;
        }
        setTemplate(t);
        setLineItems(templateToLineItems(t));
        setContractDocs(docs);
      } catch (e) {
        if (!cancelled) setLoadError(e instanceof Error ? e.message : 'Failed to load template');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [templateId]);

  const proposal = useMemo(() => (template ? templateToProposal(template) : null), [template]);

  const toggleActive = async (checked: boolean) => {
    if (!template) return;
    setTemplate(prev => (prev ? { ...prev, is_active: checked } : prev));
    try {
      await updateProposalTemplate(template.id, { is_active: checked });
    } catch {
      setTemplate(prev => (prev ? { ...prev, is_active: !checked } : prev));
      toast('Could not update status');
    }
  };

  if (loading) return <AppPreloader />;

  if (loadError || !template || !proposal) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center gap-3 text-center">
        <p className="text-sm text-gray-500">{loadError || 'Template not found'}</p>
        <Link to="/proposals?tab=templates" className="text-sm font-medium text-brand-primary hover:underline">
          Back to templates
        </Link>
      </div>
    );
  }

  return (
    <TemplateEditProvider
      mode="edit"
      template={template}
      lineItems={lineItems}
      onTemplateChange={setTemplate}
      onLineItemsChange={setLineItems}
    >
      <div className="min-h-screen bg-brand-surface">
        <header className="sticky top-0 z-20 border-b border-gray-100 bg-white/90 backdrop-blur print:hidden">
          <div className="mx-auto flex h-14 max-w-[960px] items-center gap-3 px-4">
            <Link
              to="/proposals?tab=templates"
              className="inline-flex shrink-0 items-center gap-1.5 text-sm font-medium leading-none text-gray-500 hover:text-gray-900"
            >
              <ArrowLeft className="h-4 w-4" />
              Templates
            </Link>
            <span className="shrink-0 text-sm font-normal text-gray-400">Editing template</span>
            <TemplateNameField name={template.name} />
            <SaveStatusDot />
            <label className="flex shrink-0 cursor-pointer select-none items-center gap-2 text-sm text-gray-600">
              <BrandedCheckbox checked={template.is_active} onChange={toggleActive} />
              Active
            </label>
          </div>
        </header>

        <main className="mx-auto max-w-[880px] px-4 py-8 sm:px-6">
          <ProposalDocument
            proposal={proposal}
            lineItems={lineItems}
            contractDocs={contractDocs}
            variant="template"
          />
        </main>
      </div>
    </TemplateEditProvider>
  );
}
