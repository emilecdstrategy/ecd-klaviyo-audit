import { useState } from 'react';
import { Sparkles, Wand2 } from 'lucide-react';
import { useToast } from './Toast';
import { generateVoiceProfile } from '../../lib/proposals-db';

/** Editable "house voice & style" guide the AI applies to every draft, with an
 * option to draft it from recent work. Shared by the proposal and document
 * settings panels. */
export default function VoiceProfileSection({
  domain,
  value,
  onChange,
}: {
  domain: 'proposal' | 'document';
  value: string;
  onChange: (next: string) => void;
}) {
  const toast = useToast();
  const [generating, setGenerating] = useState(false);

  const noun = domain === 'proposal' ? 'proposals' : 'documents';

  const generate = async () => {
    setGenerating(true);
    try {
      const profile = await generateVoiceProfile(domain);
      if (profile.trim()) {
        onChange(profile.trim());
        toast('Drafted a voice profile from your recent work. Review, tweak, then Save.');
      } else {
        toast(`Not enough past ${noun} yet to draft a voice profile. Write one, or come back later.`);
      }
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not generate a voice profile');
    } finally {
      setGenerating(false);
    }
  };

  return (
    <section className="rounded-xl bg-white card-shadow overflow-hidden">
      <div className="flex items-center gap-3 border-b border-gray-100 bg-gray-50/60 px-5 py-4">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg border border-gray-200 bg-white text-brand-primary">
          <Sparkles className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-semibold text-gray-900">Voice &amp; style</h3>
          <p className="text-xs text-gray-500">How the AI assistant should write. Applied to every {domain} it drafts.</p>
        </div>
        <button
          type="button"
          onClick={generate}
          disabled={generating}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
        >
          <Wand2 className="h-3.5 w-3.5" />
          {generating ? 'Generating…' : 'Generate from past work'}
        </button>
      </div>
      <div className="p-5">
        <textarea
          value={value}
          onChange={e => onChange(e.target.value)}
          rows={8}
          placeholder={`Describe your house voice: tone, sentence length, formatting habits, words you love or avoid, how you open and close. Or click "Generate from past work" to draft it from your recent ${noun}.`}
          className="w-full resize-y rounded-lg border border-gray-200 px-3 py-2 text-sm leading-relaxed focus:border-brand-primary focus:outline-none focus:ring-1 focus:ring-brand-primary/20"
        />
        <p className="mt-1 text-[11px] text-gray-400">Leave blank to use the assistant's default professional voice.</p>
      </div>
    </section>
  );
}
