import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import { ArrowUpRight, Eye, EyeOff, KeyRound, Sparkles } from 'lucide-react';
import { api } from '../../lib/api';
import type { User } from '../../types/chat';

const schema = z.object({ phone: z.string().regex(/^\d{7,15}$/, 'Enter a valid phone number.'), code: z.string().length(6, 'Use the 6-digit access code.') });
type FormValues = z.infer<typeof schema>;

interface LoginPageProps { onLogin: (user: User) => void; }

export function LoginPage({ onLogin }: LoginPageProps) {
  const [showCode, setShowCode] = useState(false);
  const [serverError, setServerError] = useState('');
  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<FormValues>({ resolver: zodResolver(schema), defaultValues: { phone: '', code: '' } });
  const submit = async (values: FormValues) => { setServerError(''); try { await api.csrf(); const result = await api.login(values.phone, values.code); onLogin(result.user); } catch (error) { setServerError(error instanceof Error ? error.message : 'Unable to sign in.'); } };
  return <main className="auth-page">
    <section className="auth-visual"><div className="auth-visual-glow" /><div className="brand-lockup"><span className="logo-mark"><Sparkles size={18} /></span><span>pulse</span></div><div className="visual-copy"><p className="kicker">REAL-TIME WORKSPACE</p><h1>Stay close to the conversation.</h1><p>Focused messaging for teams that move with intention.</p></div><div className="signal-card"><span className="signal-dot" /><span>Live sync is active</span><span className="signal-line" /></div></section>
    <section className="auth-panel"><div className="auth-card">
      <div className="auth-card-heading"><div className="mobile-logo logo-mark"><Sparkles size={16} /></div><p className="kicker">WELCOME BACK</p><h2>Enter your workspace</h2><p>Use your phone number and the development access code.</p></div>
      <form onSubmit={handleSubmit(submit)} noValidate>
        <label className="field"><span>Phone number</span><div className="input-wrap"><span className="input-prefix">+98</span><input inputMode="tel" autoComplete="tel" placeholder="912 000 0000" {...register('phone')} /></div>{errors.phone && <em>{errors.phone.message}</em>}</label>
        <label className="field"><span>Access code</span><div className="input-wrap"><KeyRound size={16} className="input-icon" /><input inputMode="numeric" autoComplete="one-time-code" placeholder="123456" type={showCode ? 'text' : 'password'} maxLength={6} {...register('code')} /><button type="button" className="field-action" aria-label={showCode ? 'Hide access code' : 'Show access code'} onClick={() => setShowCode((value) => !value)}>{showCode ? <EyeOff size={16} /> : <Eye size={16} />}</button></div>{errors.code && <em>{errors.code.message}</em>}</label>
        {serverError && <div className="form-error" role="alert">{serverError}</div>}
        <button className="button button-primary auth-submit" disabled={isSubmitting} type="submit">{isSubmitting ? 'Connecting…' : 'Enter workspace'} <ArrowUpRight size={17} /></button>
      </form>
      <p className="auth-footnote">Demo access is enabled for local development.</p>
    </div></section>
  </main>;
}
