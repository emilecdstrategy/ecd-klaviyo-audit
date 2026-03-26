import { useState } from 'react';
import { Zap, ArrowRight, Sparkles } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';

export default function Login() {
  const { signIn, signUp, enterDemo } = useAuth();
  const [isSignUp, setIsSignUp] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      if (isSignUp) {
        await signUp(email, password, name);
      } else {
        await signIn(email, password);
      }
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

          <h2 className="text-2xl font-bold text-gray-900 mb-2">
            {isSignUp ? 'Create an account' : 'Welcome back'}
          </h2>
          <p className="text-sm text-gray-500 mb-8">
            {isSignUp ? 'Set up your auditor account' : 'Sign in to your audit dashboard'}
          </p>

          <form onSubmit={handleSubmit} className="space-y-4">
            {isSignUp && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Full Name</label>
                <input
                  type="text"
                  value={name}
                  onChange={e => setName(e.target.value)}
                  required
                  className="w-full px-4 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-brand-primary focus:ring-2 focus:ring-brand-primary/20"
                  placeholder="Sarah Chen"
                />
              </div>
            )}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
              <input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                required
                className="w-full px-4 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-brand-primary focus:ring-2 focus:ring-brand-primary/20"
                placeholder="you@company.com"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Password</label>
              <input
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                required
                className="w-full px-4 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-brand-primary focus:ring-2 focus:ring-brand-primary/20"
                placeholder="Minimum 6 characters"
              />
            </div>

            {error && (
              <div className="text-sm text-red-600 bg-red-50 px-4 py-2.5 rounded-lg">{error}</div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full flex items-center justify-center gap-2 px-4 py-2.5 gradient-bg text-white font-medium rounded-lg hover:opacity-90 transition-opacity disabled:opacity-50"
            >
              {loading ? 'Please wait...' : isSignUp ? 'Create Account' : 'Sign In'}
              <ArrowRight className="w-4 h-4" />
            </button>
          </form>

          <div className="mt-4 text-center">
            <button
              onClick={() => { setIsSignUp(!isSignUp); setError(''); }}
              className="text-sm text-gray-500 hover:text-brand-primary transition-colors"
            >
              {isSignUp ? 'Already have an account? Sign in' : 'Need an account? Sign up'}
            </button>
          </div>

          <div className="mt-8 pt-8 border-t border-gray-100">
            <button
              onClick={enterDemo}
              className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-gray-50 border border-gray-200 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-100 transition-colors"
            >
              <Sparkles className="w-4 h-4 text-brand-primary" />
              Explore Demo Mode
              <span className="text-xs text-gray-400 ml-1">No login required</span>
            </button>
          </div>
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
