import React, { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { base44 } from "@/api/base44Client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Lock, Loader2, AlertTriangle, Eye, EyeOff, ShieldCheck } from "lucide-react";
import AuthLayout from "@/components/AuthLayout";

const inputClass = "pl-10 pr-12 h-12 bg-slate-900/60 border-slate-700/50 text-slate-100 placeholder:text-slate-600 rounded-xl focus:border-sky-500/50 focus:ring-sky-500/20";
const iconClass = "absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500";

function PasswordStrength({ password }) {
  const checks = [
    { label: "8+ characters", pass: password.length >= 8 },
    { label: "Uppercase letter", pass: /[A-Z]/.test(password) },
    { label: "Lowercase letter", pass: /[a-z]/.test(password) },
    { label: "Number", pass: /[0-9]/.test(password) },
  ];
  const score = checks.filter(c => c.pass).length;
  const barColors = ["bg-red-500", "bg-orange-500", "bg-yellow-500", "bg-emerald-500"];
  if (!password) return null;

  return (
    <div className="mt-2 space-y-2">
      <div className="flex gap-1">
        {[0, 1, 2, 3].map(i => (
          <div key={i} className="h-1 flex-1 rounded-full bg-slate-700/70 overflow-hidden">
            <div className={`h-full rounded-full transition-all duration-300 ${i < score ? barColors[score - 1] : 'bg-transparent'}`} style={{ width: i < score ? '100%' : '0%' }} />
          </div>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-x-3 gap-y-1">
        {checks.map((c, i) => (
          <span key={i} className={`text-[10px] font-medium ${c.pass ? 'text-emerald-400' : 'text-slate-600'}`}>
            {c.pass ? '✓' : '○'} {c.label}
          </span>
        ))}
      </div>
    </div>
  );
}

export default function ResetPassword() {
  const [searchParams] = useSearchParams();
  const resetToken = searchParams.get("token");

  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    if (newPassword !== confirmPassword) { setError("Passwords do not match"); return; }
    if (newPassword.length < 8) { setError("Password must be at least 8 characters"); return; }
    setLoading(true);
    try {
      await base44.auth.resetPassword({ resetToken, newPassword });
      window.location.href = "/login";
    } catch (err) {
      setError(err.message || "Failed to reset password");
    } finally { setLoading(false); }
  };

  if (!resetToken) {
    return (
      <AuthLayout
        icon={AlertTriangle}
        title="Invalid reset link"
        subtitle="This password reset link is missing or invalid"
        footer={
          <Link to="/forgot-password" className="text-sky-400 font-semibold hover:text-sky-300 transition-colors">
            Request a new link
          </Link>
        }
      >
        <p className="text-sm text-slate-400 text-center leading-relaxed">
          The link you used appears to be incomplete. Please request a new password reset email.
        </p>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout
      icon={ShieldCheck}
      title="New password"
      subtitle="Choose a strong password for your account"
    >
      {error && (
        <div className="mb-5 p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-sm font-medium">{error}</div>
      )}

      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="space-y-1.5">
          <label htmlFor="password" className="text-xs font-semibold uppercase tracking-wider text-slate-400">New Password</label>
          <div className="relative">
            <Lock className={iconClass} aria-hidden="true" />
            <Input
              id="password" type={showPassword ? "text" : "password"} autoComplete="new-password" autoFocus
              placeholder="••••••••" value={newPassword} onChange={e => setNewPassword(e.target.value)}
              className={inputClass} required
            />
            <button type="button" onClick={() => setShowPassword(v => !v)}
              className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300 transition-colors" tabIndex={-1}>
              {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>
          <PasswordStrength password={newPassword} />
        </div>

        <div className="space-y-1.5">
          <label htmlFor="confirm" className="text-xs font-semibold uppercase tracking-wider text-slate-400">Confirm Password</label>
          <div className="relative">
            <Lock className={iconClass} aria-hidden="true" />
            <Input
              id="confirm" type={showConfirm ? "text" : "password"} autoComplete="new-password"
              placeholder="••••••••" value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)}
              className={inputClass} required
            />
            <button type="button" onClick={() => setShowConfirm(v => !v)}
              className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300 transition-colors" tabIndex={-1}>
              {showConfirm ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>
          {confirmPassword && newPassword !== confirmPassword && (
            <p className="text-[10px] font-medium text-red-400 mt-1">Passwords do not match</p>
          )}
        </div>

        <Button
          type="submit"
          className="w-full h-12 font-semibold rounded-xl text-sm tracking-wide"
          style={{ background: 'linear-gradient(135deg, #0284c7, #0369a1)', border: '1px solid rgba(56,189,248,0.3)', boxShadow: '0 4px 14px rgba(2,132,199,0.25)' }}
          disabled={loading}
        >
          {loading ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Resetting…</> : "Reset password"}
        </Button>
      </form>
    </AuthLayout>
  );
}