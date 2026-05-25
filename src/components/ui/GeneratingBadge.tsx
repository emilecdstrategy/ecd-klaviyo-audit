import { Loader2 } from 'lucide-react';

export default function GeneratingBadge() {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-indigo-50 px-2 py-0.5 text-[11px] font-medium text-indigo-700">
      <Loader2 className="h-3 w-3 animate-spin" />
      Generating
    </span>
  );
}
