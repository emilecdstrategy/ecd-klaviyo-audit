import { Sparkles, X } from 'lucide-react';
import { useState } from 'react';

export default function DemoBanner() {
  const [visible, setVisible] = useState(true);
  if (!visible) return null;

  return (
    <div className="gradient-bg text-white px-6 py-2.5 flex items-center justify-between text-sm">
      <div className="flex items-center gap-2">
        <Sparkles className="w-4 h-4" />
        <span className="font-medium">Demo Mode</span>
        <span className="text-white/80">
          — You're viewing sample data. Sign in to create real audits.
        </span>
      </div>
      <button
        onClick={() => setVisible(false)}
        className="p-1 rounded hover:bg-white/20 transition-colors"
      >
        <X className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}
