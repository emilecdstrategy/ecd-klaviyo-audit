import { createContext, useContext, type ReactNode } from 'react';
import { buildEntityLookup, type EntityType } from '../../../lib/entity-tags';

type ReportEntityContextValue = {
  entityLookup: Map<string, EntityType>;
  autoTagEntities: boolean;
};

const ReportEntityContext = createContext<ReportEntityContextValue>({
  entityLookup: new Map(),
  autoTagEntities: true,
});

export function ReportEntityProvider({
  children,
  flowSnapshots = [],
  flowPerformance = [],
  segmentSnapshots = [],
  campaignSnapshots = [],
  formSnapshots = [],
  autoTagEntities = true,
}: {
  children: ReactNode;
  flowSnapshots?: { name?: string | null }[];
  flowPerformance?: { flow_name?: string | null }[];
  segmentSnapshots?: { name?: string | null }[];
  campaignSnapshots?: { name?: string | null }[];
  formSnapshots?: { name?: string | null }[];
  autoTagEntities?: boolean;
}) {
  const entityLookup = buildEntityLookup({
    flows: flowSnapshots,
    flowPerformance,
    segments: segmentSnapshots,
    campaigns: campaignSnapshots,
    forms: formSnapshots,
  });

  return (
    <ReportEntityContext.Provider value={{ entityLookup, autoTagEntities }}>
      {children}
    </ReportEntityContext.Provider>
  );
}

export function useReportEntities() {
  return useContext(ReportEntityContext);
}
