'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import type { AuthResponse } from '@/game/api';
import { AuthShell, FormField } from '@/components/AuthShell';
import { ActionButton } from '@/components/ui';
import { apiPost, errorMessage } from '@/lib/api';

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await apiPost<AuthResponse>('/api/auth/login', { email: email.trim(), password });
      router.replace(res.hasClan ? '/game' : '/found');
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  };

  return (
    <AuthShell
      title="Return to your castle"
      subtitle="The realm moved on while you were away. See what became of it."
      footer={
        <>
          No clan yet?{' '}
          <Link href="/register" className="tap-link font-bold text-gold">
            Begin your rise
          </Link>
        </>
      }
    >
      <form onSubmit={submit} className="space-y-4" noValidate>
        <FormField label="Email">
          <input className="field" type="email" autoComplete="email" inputMode="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" />
        </FormField>
        <FormField label="Password">
          <input className="field" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
        </FormField>
        {error ? (
          <p className="rounded-[3px] border border-vermilion-deep/50 bg-vermilion/10 px-3 py-2 text-sm font-medium text-vermilion-deep" role="alert">
            {error}
          </p>
        ) : null}
        <ActionButton type="submit" variant="primary" busy={busy} wrapperClassName="flex w-full" className="w-full">
          Enter
        </ActionButton>
      </form>
    </AuthShell>
  );
}
