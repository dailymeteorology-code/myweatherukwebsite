import React, { useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '@/lib/AuthContext';
import { ShieldAlert, Lock, Home } from 'lucide-react';
import { Link } from 'react-router-dom';

/**
 * AdminOnlyRoute — gates any route to admin users only. Non-admins see a
 * clear "Access denied" screen rather than the page contents. Used to lock
 * down /AdminSettings so the admin panel can't be reached just by typing
 * the URL.
 */
function DefaultLoading() {
  return (
    <div style={{ position: 'fixed', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#05090f' }}>
      <div style={{ width: 32, height: 32, border: '3px solid rgba(56,189,248,0.18)', borderTopColor: '#38bdf8', borderRadius: '50%', animation: 'spin 0.9s linear infinite' }} />
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
    </div>
  );
}

function AccessDenied() {
  return (
    <div style={{
      minHeight: '100vh', background: 'linear-gradient(160deg,#05090f 0%,#0a1020 100%)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24,
      fontFamily: "'DM Sans',system-ui,sans-serif",
    }}>
      <div style={{ maxWidth: 460, width: '100%', textAlign: 'center' }}>
        <div style={{
          width: 64, height: 64, borderRadius: 18, margin: '0 auto 18px',
          background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.30)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <Lock style={{ width: 26, height: 26, color: '#f87171' }} />
        </div>
        <h1 style={{ margin: 0, fontSize: 22, fontWeight: 800, color: '#f1f5f9', letterSpacing: '-0.02em' }}>
          Admin access only
        </h1>
        <p style={{ margin: '8px 0 22px', fontSize: 13.5, color: '#94a3b8', lineHeight: 1.6 }}>
          You don't have permission to view this page. Admin settings are restricted to site administrators.
        </p>
        <Link to="/" style={{
          display: 'inline-flex', alignItems: 'center', gap: 7,
          padding: '10px 18px', borderRadius: 11,
          background: 'linear-gradient(135deg,#0ea5e9,#0369a1)',
          color: '#fff', fontSize: 13, fontWeight: 700, textDecoration: 'none',
          boxShadow: '0 4px 20px rgba(56,189,248,0.25)',
        }}>
          <Home style={{ width: 14, height: 14 }} /> Back to Home
        </Link>
      </div>
    </div>
  );
}

export default function AdminOnlyRoute({ children }) {
  const { isAuthenticated, isLoadingAuth, user, authError } = useAuth();
  // While auth resolves, never render the protected children — they would
  // briefly flash before the access check completes.
  if (isLoadingAuth) return <DefaultLoading />;
  if (authError || !isAuthenticated) return <Navigate to="/login" replace />;
  if (user?.role !== 'admin') return <AccessDenied />;
  return children;
}