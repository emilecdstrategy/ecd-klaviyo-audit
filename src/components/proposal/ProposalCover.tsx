import ReportBrandMark from '../report/ReportBrandMark';
import SiteFavicon from '../ui/SiteFavicon';
import ProposalPlainText from './edit/ProposalPlainText';
import { useProposalEdit } from './edit/ProposalEditContext';
import type { Client, Proposal, ProposalSettings } from '../../lib/types';

type ProposalCoverProps = {
  proposal: Proposal;
  client: Client;
  settings: ProposalSettings;
};

export default function ProposalCover({ proposal, client, settings }: ProposalCoverProps) {
  const { editMode, updateTitle } = useProposalEdit();
  const tagline = proposal.cover?.tagline ?? settings.cover.tagline;
  const displayDate = proposal.cover?.display_date
    ? proposal.cover.display_date
    : new Date(proposal.sent_at ?? proposal.created_at).toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      });

  return (
    <div className="proposal-section relative overflow-hidden rounded-3xl text-white shadow-xl shadow-brand-primary/15 ring-1 ring-white/10">
      <div
        className="absolute inset-0 bg-gradient-to-br from-brand-navy via-brand-primary-dark to-brand-primary"
        aria-hidden
      />
      {settings.cover.background_url && (
        <img
          src={settings.cover.background_url}
          alt=""
          className="absolute inset-0 h-full w-full object-cover opacity-25"
          aria-hidden
        />
      )}
      <div className="pointer-events-none absolute -right-24 -top-32 h-80 w-80 rounded-full bg-white/10 blur-3xl" aria-hidden />
      <div className="pointer-events-none absolute -bottom-20 -left-16 h-64 w-64 rounded-full bg-brand-primary-light/30 blur-3xl" aria-hidden />
      <div
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_70%_60%_at_50%_-10%,rgba(255,255,255,0.14),transparent)]"
        aria-hidden
      />

      <div className="relative px-8 py-8 sm:px-12 sm:py-10 lg:px-14 lg:py-12">
        <div className="flex flex-col gap-6 sm:flex-row sm:items-start sm:justify-between sm:gap-8">
          {settings.cover.logo_url ? (
            <img src={settings.cover.logo_url} alt="ECD Digital Strategy" className="h-12 w-auto object-contain" />
          ) : (
            <ReportBrandMark size="lg" inverted subtitle="Proposal" />
          )}

          <div className="flex flex-wrap items-center gap-x-6 gap-y-3 text-sm sm:shrink-0 sm:justify-end sm:text-right">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wider text-white/50">Date</p>
              <p className="mt-0.5 font-medium text-white/90">{displayDate}</p>
            </div>
            <div className="hidden h-8 w-px bg-white/15 sm:block" aria-hidden />
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wider text-white/50">Proposal</p>
              <p className="mt-0.5 font-medium text-white/90 tabular-nums">
                ECD-{String(proposal.proposal_number).padStart(4, '0')}
              </p>
            </div>
          </div>
        </div>

        <div className="mt-8 max-w-3xl">
          <p className="mb-3 text-[11px] font-bold uppercase tracking-[0.22em] text-white/60">
            Prepared for
          </p>
          <h1 className="flex items-center gap-2.5 text-3xl font-extrabold tracking-tight sm:gap-3 sm:text-4xl lg:text-[2.75rem] lg:leading-[1.1]">
            <SiteFavicon url={client.website_url} size="md" variant="onDark" className="shrink-0" />
            <span>{client.company_name}</span>
          </h1>
          {editMode ? (
            <ProposalPlainText
              value={proposal.title}
              onSave={updateTitle}
              as="p"
              placeholder="Proposal title"
              className="mt-4 max-w-2xl text-base leading-relaxed text-white/80 sm:text-lg"
            />
          ) : (
            <p className="mt-4 max-w-2xl text-base leading-relaxed text-white/80 sm:text-lg">
              {proposal.title}
            </p>
          )}
          {tagline ? (
            <p className="mt-6 text-sm font-medium uppercase tracking-[0.18em] text-white/50">{tagline}</p>
          ) : null}
        </div>
      </div>
    </div>
  );
}
