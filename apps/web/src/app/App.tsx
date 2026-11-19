import { MotionConfig } from 'motion/react';
import { lazy, Suspense } from 'react';
import { createBrowserRouter, Navigate, Outlet, RouterProvider, useLocation } from 'react-router-dom';

import { FullScreenSpinner } from '../components/FullScreenSpinner';
import { Landing } from '../routes/Landing';
import { Login } from '../routes/Login';
import { NotFound } from '../routes/NotFound';
import { Register } from '../routes/Register';
import { ChatSession, useSession } from './session';

const AppShell = lazy(() => import('../components/AppShell').then((m) => ({ default: m.AppShell })));
const Workspace = lazy(() => import('../routes/Workspace').then((m) => ({ default: m.Workspace })));
const Profile = lazy(() => import('../routes/Profile').then((m) => ({ default: m.Profile })));
const UserProfile = lazy(() => import('../routes/UserProfile').then((m) => ({ default: m.UserProfile })));
const Settings = lazy(() => import('../routes/Settings').then((m) => ({ default: m.Settings })));

function RequireAuth() {
  const session = useSession();
  const location = useLocation();
  if (session.isPending) return <FullScreenSpinner />;
  const user = session.data?.user;
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  return (
    <ChatSession userId={user.id}>
      <Suspense fallback={<FullScreenSpinner />}>
        <AppShell />
      </Suspense>
    </ChatSession>
  );
}

function GuestOnly() {
  const session = useSession();
  if (session.isPending) return <FullScreenSpinner />;
  return session.data?.user ? <Navigate to="/app" replace /> : <Outlet />;
}

const router = createBrowserRouter(
  [
    { path: '/', element: <Landing /> },
    {
      element: <GuestOnly />,
      children: [
        { path: '/login', element: <Login /> },
        { path: '/register', element: <Register /> },
      ],
    },
    {
      path: '/app',
      element: <RequireAuth />,
      children: [
        { index: true, element: <Workspace /> },
        { path: 'c/:conversationId', element: <Workspace /> },
        { path: 'profile', element: <Profile /> },
        { path: 'u/:userId', element: <UserProfile /> },
        { path: 'settings', element: <Settings /> },
      ],
    },
    { path: '*', element: <NotFound /> },
  ],
  { basename: import.meta.env.BASE_URL.replace(/\/$/, '') || '/' },
);

export function App() {
  return (
    <MotionConfig reducedMotion="user">
      <RouterProvider router={router} />
    </MotionConfig>
  );
}
