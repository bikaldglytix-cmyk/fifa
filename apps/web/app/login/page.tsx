'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useAuth } from '../../lib/auth';
import { Button, Input, useToast } from '../../components/ui';
import { AuthShell } from '../../components/auth-shell';

export default function LoginPage() {
  const { login, completeMfa, resetPassword } = useAuth();
  const router = useRouter();
  const { show, node } = useToast();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [mfaToken, setMfaToken] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [resetSent, setResetSent] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      if (mfaToken) {
        await completeMfa(mfaToken, code);
        router.push('/');
        return;
      }
      const res = await login(email, password);
      if (res.requiresMfa && res.mfaToken) {
        setMfaToken(res.mfaToken);
        show('Enter your 6-digit authenticator code');
      } else {
        router.push('/');
      }
    } catch (err: any) {
      show(err.message ?? 'Login failed', 'error');
    } finally {
      setBusy(false);
    }
  };

  const forgot = async () => {
    if (!email) {
      show('Enter your email first, then tap "Forgot password"', 'error');
      return;
    }
    try {
      await resetPassword(email);
      setResetSent(true);
      show('Password reset email sent');
    } catch (err: any) {
      show(err.message ?? 'Could not send reset email', 'error');
    }
  };

  return (
    <AuthShell title="Welcome back" subtitle="Sign in to simulate, predict and manage your XI.">
      <form onSubmit={submit} className="grid gap-3.5">
        {!mfaToken ? (
          <>
            <Input label="Email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus autoComplete="email" />
            <Input
              label="Password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              autoComplete="current-password"
            />
            <button type="button" onClick={() => void forgot()} className="-mt-1 justify-self-end text-xs text-muted transition hover:text-primary">
              {resetSent ? 'Reset email sent ✓' : 'Forgot password?'}
            </button>
          </>
        ) : (
          <Input
            label="Authenticator code"
            inputMode="numeric"
            maxLength={6}
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
            placeholder="123456"
            autoFocus
          />
        )}
        <Button type="submit" disabled={busy} size="lg" className="mt-1 w-full">
          {busy ? 'Signing in…' : mfaToken ? 'Verify code' : 'Sign in'}
        </Button>
      </form>
      <p className="mt-5 text-center text-xs text-muted">
        No account?{' '}
        <Link href="/register" className="font-semibold text-primary">
          Sign up free
        </Link>
      </p>
      {node}
    </AuthShell>
  );
}
