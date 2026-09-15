import { useState, type FormEvent } from 'react';
import { ArrowRight, Eye, EyeOff, LockKeyhole, ShieldCheck } from 'lucide-react';

export function LoginScreen({
  onLogin,
}: {
  onLogin: (email: string, password: string) => Promise<void>;
}) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError('');
    setLoading(true);
    try {
      await onLogin(email, password);
    } catch (loginError) {
      setError(loginError instanceof Error ? loginError.message : 'Sign-in failed.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="login-shell">
      <section className="login-brand-panel" aria-label="Scientechnic Lighting Projects">
        <div className="scient-brand">
          <span className="scient-wordmark">SCIENTECHNIC</span>
          <small>empowering tomorrow</small>
        </div>
        <div className="login-brand-copy">
          <span className="eyebrow">Lighting Solutions</span>
          <h1>One workspace for every lighting project.</h1>
          <p>
            Coordinate briefs, calculations, drawings, workloads, revisions, and delivery with a
            complete project history.
          </p>
        </div>
        <div className="login-trust-note">
          <ShieldCheck />
          <span>
            <strong>Standalone and secure</strong>
            <small>No Microsoft tenant or IT approval is required for this mode.</small>
          </span>
        </div>
      </section>

      <section className="login-form-panel">
        <form className="login-card" onSubmit={submit}>
          <div className="login-icon">
            <LockKeyhole />
          </div>
          <div>
            <span className="eyebrow">Team access</span>
            <h2>Sign in to your workspace</h2>
            <p>Use the account created for you by the application Admin.</p>
          </div>
          <label className="field">
            Work email
            <input
              type="email"
              autoComplete="username"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="name@company.com"
              required
            />
          </label>
          <label className="field">
            Password
            <span className="password-field">
              <input
                type={showPassword ? 'text' : 'password'}
                autoComplete="current-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                required
              />
              <button
                type="button"
                onClick={() => setShowPassword((value) => !value)}
                aria-label={showPassword ? 'Hide password' : 'Show password'}
              >
                {showPassword ? <EyeOff /> : <Eye />}
              </button>
            </span>
          </label>
          {error ? (
            <p className="login-error" role="alert">
              {error}
            </p>
          ) : null}
          <button className="button primary login-submit" type="submit" disabled={loading}>
            {loading ? 'Signing in…' : 'Sign in'} <ArrowRight />
          </button>
          <small className="login-help">
            Contact your application Admin if you need an account or password reset.
          </small>
        </form>
      </section>
    </main>
  );
}
