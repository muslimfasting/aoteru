'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import type { AuthResponse } from '@/game/api';
import { NAME_RULES } from '@/game/config';
import { AuthShell, FormField } from '@/components/AuthShell';
import { ActionButton } from '@/components/ui';
import { apiPost, errorMessage } from '@/lib/api';

function nicknameError(v: string): string | null {
  const r = NAME_RULES.nickname;
  if (v.length < r.min || v.length > r.max) return `Use ${r.min}–${r.max} characters.`;
  if (!r.pattern.test(v)) return 'Letters, numbers, underscore and hyphen only.';
  return null;
}

export default function RegisterPage() {
  const router = useRouter();
  const [nickname, setNickname] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const nickErr = nicknameError(nickname.trim());
  const emailErr = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) ? null : 'Enter a valid email address.';
  const passErr = password.length >= NAME_RULES.passwordMin ? null : `At least ${NAME_RULES.passwordMin} characters.`;
  const invalid = Boolean(nickErr || emailErr || passErr);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setTouched(true);
    if (busy || invalid) return;
    setBusy(true);
    setError(null);
    try {
      await apiPost<AuthResponse>('/api/auth/register', { email: email.trim(), password, nickname: nickname.trim() });
      router.replace('/found');
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  };

  return (
    <AuthShell
      title="Begin your rise"
      subtitle="Create an account, then name your Daimyo and raise your banner."
      footer={
        <>
          Already rule a province?{' '}
          <Link href="/login" className="tap-link font-bold text-gold">
            Sign in
          </Link>
        </>
      }
    >
      <form onSubmit={submit} className="space-y-4" noValidate>
        <FormField label="Nickname" hint="Shown to other players. Must be unique." error={touched ? nickErr : null}>
          <input className="field" autoComplete="nickname" maxLength={NAME_RULES.nickname.max} required value={nickname} onChange={(e) => setNickname(e.target.value)} placeholder="e.g. Kagetora" />
        </FormField>
        <FormField label="Email" error={touched ? emailErr : null}>
          <input className="field" type="email" autoComplete="email" inputMode="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" />
        </FormField>
        <FormField label="Password" hint={`At least ${NAME_RULES.passwordMin} characters.`} error={touched ? passErr : null}>
          <input className="field" type="password" autoComplete="new-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
        </FormField>
        {error ? (
          <p className="rounded-[3px] border border-vermilion-deep/50 bg-vermilion/10 px-3 py-2 text-sm font-medium text-vermilion-deep" role="alert">
            {error}
          </p>
        ) : null}
        <ActionButton type="submit" variant="primary" busy={busy} wrapperClassName="flex w-full" className="w-full">
          Create account
        </ActionButton>
      </form>
    </AuthShell>
  );
}
