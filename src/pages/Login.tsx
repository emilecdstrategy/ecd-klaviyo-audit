import { useState } from 'react';
import { Zap, ArrowRight, Mail } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';

export default function Login() {
  const { sendMagicLink, authError } = useAuth();
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await sendMagicLink(email);
      setSent(true);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'An error occurred');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-white flex">
      <div className="flex-1 flex items-center justify-center p-8">
        <div className="w-full max-w-md">
          <div className="flex items-center gap-3 mb-8">
            <div className="w-10 h-10 rounded-xl gradient-bg flex items-center justify-center">
              <Zap className="w-5 h-5 text-white" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-gray-900">ECD Audit Dashboard</h1>
              <p className="text-sm text-gray-500">Klaviyo Audit Platform</p>
            </div>
          </div>

          <h2 className="text-2xl font-bold text-gray-900 mb-2">Sign in</h2>
          <p className="text-sm text-gray-500 mb-8">
            We'll email you a magic link. Only <span className="font-medium">@ecdigitalstrategy.com</span> accounts are allowed.
          </p>

          {sent ? (
            <div className="bg-emerald-50 border border-emerald-100 rounded-xl p-5">
              <div className="flex items-start gap-3">
                <div className="w-9 h-9 rounded-lg bg-emerald-500/10 flex items-center justify-center shrink-0">
                  <Mail className="w-4 h-4 text-emerald-600" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-emerald-900">Magic link sent</p>
                  <p className="text-sm text-emerald-800/80 mt-1">
                    Check your inbox for <span className="font-medium">{email}</span> and click the sign-in link.
                  </p>
                  <button
                    onClick={() => { setSent(false); setError(''); }}
                    className="mt-3 text-sm font-medium text-emerald-700 hover:underline"
                  >
                    Use a different email
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Work Email</label>
                <input
                  type="email"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  required
                  className="w-full px-4 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-brand-primary focus:ring-2 focus:ring-brand-primary/20"
                  placeholder="you@ecdigitalstrategy.com"
                />
              </div>

              {(error || authError) && (
                <div className="text-sm text-red-600 bg-red-50 px-4 py-2.5 rounded-lg">
                  {error || authError}
                </div>
              )}

              <button
                type="submit"
                disabled={loading}
                className="w-full flex items-center justify-center gap-2 px-4 py-2.5 gradient-bg text-white font-medium rounded-lg hover:opacity-90 transition-opacity disabled:opacity-50"
              >
                {loading ? 'Sending link...' : 'Send magic link'}
                <ArrowRight className="w-4 h-4" />
              </button>
            </form>
          )}
        </div>
      </div>

      <div className="hidden lg:flex flex-1 gradient-bg items-center justify-center p-12">
        <div className="max-w-md text-white">
          <h2 className="text-3xl font-bold mb-4">Professional Klaviyo Audits</h2>
          <p className="text-white/80 text-lg mb-8">
            Run strategic email audits, uncover revenue opportunities, and deliver
            polished reports that convert prospects into clients.
          </p>
          <div className="space-y-4">
            {[
              'AI-powered audit analysis',
              'Side-by-side visual comparisons',
              'Revenue opportunity calculator',
              'Shareable client-facing reports',
            ].map((item, i) => (
              <div key={i} className="flex items-center gap-3">
                <div className="w-6 h-6 rounded-full bg-white/20 flex items-center justify-center">
                  <div className="w-2 h-2 rounded-full bg-white" />
                </div>
                <span className="text-white/90">{item}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
