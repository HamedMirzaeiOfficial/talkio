import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { LoginPage } from '../features/auth/LoginPage';
import { Workspace } from '../features/workspace/Workspace';
import type { User } from '../types/chat';

function AuthenticatedApp() {
  const queryClient = useQueryClient();
  const { data, isLoading, isError } = useQuery({ queryKey: ['me'], queryFn: api.me, retry: false });
  if (isLoading) return <div className="app-loading"><span className="loading-mark">✦</span><span>Loading your workspace…</span></div>;
  if (isError || !data?.user) return <LoginPage onLogin={(user) => queryClient.setQueryData(['me'], { user })} />;
  return <Routes><Route path="/" element={<Workspace user={data.user} onLogout={async () => { await api.logout(); queryClient.clear(); }} />} /><Route path="*" element={<Navigate to="/" replace />} /></Routes>;
}

export default function App() { return <BrowserRouter><AuthenticatedApp /></BrowserRouter>; }
