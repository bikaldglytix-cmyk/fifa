'use client';

import { useState } from 'react';
import { patch, post } from '../../lib/api';
import { useApi } from '../../lib/hooks';
import { useAuth } from '../../lib/auth';
import { Badge, Button, Card, Input, Select, useToast } from '../../components/ui';
import { PageSkeleton } from '../../components/intel';

export default function ProfilePage() {
  const { user, loading, refreshUser } = useAuth();
  const { show, node } = useToast();
  const { data: notifications } = useApi<any[]>(user ? '/users/me/notifications' : null);
  const [mfa, setMfa] = useState<{ qrDataUrl: string; secret: string } | null>(null);
  const [code, setCode] = useState('');

  if (loading) return <PageSkeleton cards={2} />;
  if (!user) {
    return (
      <Card className="mx-auto max-w-md text-center">
        <p className="py-6 text-sm text-muted">Log in to manage your profile.</p>
        <a href="/login"><Button>Log in</Button></a>
      </Card>
    );
  }

  const startMfa = async () => {
    try {
      setMfa(await post<any>('/auth/mfa/setup'));
    } catch (e: any) {
      show(e.message, 'error');
    }
  };

  const confirmMfa = async () => {
    try {
      await post('/auth/mfa/verify', { code });
      show('Two-factor authentication enabled ✓');
      setMfa(null);
      setCode('');
      await refreshUser();
    } catch (e: any) {
      show(e.message, 'error');
    }
  };

  const disableMfa = async () => {
    try {
      await post('/auth/mfa/disable', { code });
      show('MFA disabled');
      setCode('');
      await refreshUser();
    } catch (e: any) {
      show(e.message, 'error');
    }
  };

  const setTheme = async (theme: string) => {
    document.documentElement.dataset.theme = theme;
    try {
      await patch('/users/me/preferences', { theme });
    } catch { /* preference persists best-effort */ }
  };

  return (
    <div className="grid gap-4 md:grid-cols-2">
      <Card title="Account">
        <div className="grid gap-2 text-sm">
          <Row label="Username" value={user.username} />
          <Row label="Email" value={user.email} />
          <Row label="Role" value={<Badge color={user.role === 'premium' ? 'gold' : user.role === 'admin' ? 'danger' : 'primary'}>{user.role}</Badge>} />
          <Row label="Supports" value={user.countryCode ?? '—'} />
          <Row label="Member since" value={new Date(user.createdAt).toLocaleDateString()} />
        </div>
        <div className="mt-4 grid gap-2">
          <Select label="Theme" defaultValue={(user as any).preferences?.theme ?? 'dark'} onChange={(e) => void setTheme(e.target.value)}>
            <option value="dark">Dark (tournament mode)</option>
            <option value="light">Light</option>
          </Select>
        </div>
      </Card>

      <Card title="Security — two-factor authentication">
        {user.mfaEnabled ? (
          <div className="grid gap-3">
            <p className="text-sm text-success">✓ MFA is active on your account.</p>
            <Input label="Enter current code to disable" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} maxLength={6} />
            <Button variant="danger" onClick={() => void disableMfa()} disabled={code.length !== 6}>Disable MFA</Button>
          </div>
        ) : mfa ? (
          <div className="grid gap-3">
            <p className="text-sm text-muted">Scan with Google Authenticator / Authy, then confirm with a code:</p>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={mfa.qrDataUrl} alt="MFA QR" className="mx-auto h-44 w-44 rounded-lg bg-white p-2" />
            <p className="break-all text-center font-mono text-[10px] text-muted">{mfa.secret}</p>
            <Input label="6-digit code" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} maxLength={6} />
            <Button onClick={() => void confirmMfa()} disabled={code.length !== 6}>Confirm & enable</Button>
          </div>
        ) : (
          <div className="grid gap-3">
            <p className="text-sm text-muted">Protect your account with TOTP (PRD-grade security, RS256 JWTs + rotating refresh tokens already on).</p>
            <Button onClick={() => void startMfa()}>Set up MFA</Button>
          </div>
        )}
      </Card>

      <Card title="Notifications" className="md:col-span-2">
        {!notifications?.length ? (
          <p className="py-4 text-center text-sm text-muted">Nothing yet — lineup locks, scored predictions and fantasy points land here.</p>
        ) : (
          <div className="grid gap-1">
            {notifications.map((n) => (
              <div key={n.id} className={`rounded-lg px-3 py-2 text-sm ${n.readAt ? 'text-muted' : 'bg-elevated'}`}>
                <b>{n.title}</b> {n.body && <span className="text-muted">— {n.body}</span>}
                <span className="float-right font-mono text-[10px] text-muted">{new Date(n.createdAt).toLocaleString()}</span>
              </div>
            ))}
          </div>
        )}
      </Card>
      {node}
    </div>
  );
}

const Row = ({ label, value }: { label: string; value: React.ReactNode }) => (
  <div className="flex items-center justify-between border-b border-line/40 pb-1.5">
    <span className="text-muted">{label}</span>
    <span className="font-medium">{value}</span>
  </div>
);
