'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useAuth } from '../../lib/auth';
import { useApi } from '../../lib/hooks';
import { Button, Flag, Input, useToast } from '../../components/ui';
import { AuthShell } from '../../components/auth-shell';

export default function RegisterPage() {
  const { register } = useAuth();
  const router = useRouter();
  const { show, node } = useToast();
  const { data: countries } = useApi<any[]>('/countries', { auth: false });
  const [form, setForm] = useState({ email: '', username: '', password: '', countryCode: '' });
  const [busy, setBusy] = useState(false);
  const [confirmEmail, setConfirmEmail] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const res = await register({ ...form, countryCode: form.countryCode || undefined });
      if (res.needsEmailConfirm) {
        setConfirmEmail(true);
        return;
      }
      show('Welcome to the World Cup!');
      router.push('/my-team');
    } catch (err: any) {
      show(err.message ?? 'Registration failed', 'error');
    } finally {
      setBusy(false);
    }
  };

  if (confirmEmail) {
    return (
      <AuthShell title="Check your inbox" subtitle="One tap and you're on the pitch.">
        <div className="rounded-2xl border border-primary/30 bg-primary/10 p-5 text-sm leading-relaxed">
          We sent a confirmation link to <b className="text-primary">{form.email}</b>. Open it to activate your
          account, then sign in — your fantasy XI, predictions and leaderboard spot will be waiting.
        </div>
        <Link href="/login" className="mt-5 block">
          <Button className="w-full" size="lg">
            Go to sign in
          </Button>
        </Link>
      </AuthShell>
    );
  }

  return (
    <AuthShell title="Create your account" subtitle="Free forever. Premium unlocks 100k-run Monte Carlo and deep analytics.">
      <form onSubmit={submit} className="grid gap-3.5">
        <Input
          label="Email"
          type="email"
          value={form.email}
          onChange={(e) => setForm({ ...form, email: e.target.value })}
          required
          autoComplete="email"
        />
        <Input
          label="Username"
          value={form.username}
          onChange={(e) => setForm({ ...form, username: e.target.value })}
          required
          minLength={3}
          placeholder="letters, numbers, _ . -"
        />
        <Input
          label="Password (min 8 chars)"
          type="password"
          value={form.password}
          onChange={(e) => setForm({ ...form, password: e.target.value })}
          required
          minLength={8}
          autoComplete="new-password"
        />
        <div>
          <span className="mb-1 block text-xs font-medium text-muted">Country you support (optional)</span>
          <div className="grid max-h-40 grid-cols-6 gap-1 overflow-y-auto rounded-xl border border-line bg-elevated/60 p-2">
            {countries?.map((c) => (
              <button
                type="button"
                key={c.code}
                title={c.name}
                onClick={() => setForm({ ...form, countryCode: form.countryCode === c.code ? '' : c.code })}
                className={`flex flex-col items-center gap-0.5 rounded-md p-1.5 text-[9px] transition ${
                  form.countryCode === c.code ? 'bg-primary/20 ring-1 ring-primary' : 'hover:bg-line'
                }`}
              >
                <Flag code={c.code} size={26} />
                {c.code}
              </button>
            ))}
          </div>
        </div>
        <Button type="submit" disabled={busy} size="lg" className="mt-1 w-full">
          {busy ? 'Creating…' : 'Create account'}
        </Button>
      </form>
      <p className="mt-5 text-center text-xs text-muted">
        Already registered?{' '}
        <Link href="/login" className="font-semibold text-primary">
          Sign in
        </Link>
      </p>
      {node}
    </AuthShell>
  );
}
