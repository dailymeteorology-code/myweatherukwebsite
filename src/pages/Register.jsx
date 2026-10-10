import React, { useState } from "react";
import { Link } from "react-router-dom";
import { base44 } from "@/api/base44Client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { UserPlus, Mail, Lock, Loader2, Eye, EyeOff, ShieldCheck } from "lucide-react";
import { InputOTP, InputOTPGroup, InputOTPSlot } from "@/components/ui/input-otp";
import AuthLayout from "@/components/AuthLayout";
import GoogleIcon from "@/components/GoogleIcon";
import { toast } from "@/components/ui/use-toast";

const inputClass = "pl-10 h-12 bg-slate-900/60 border-slate-700/50 text-slate-100 placeholder:text-slate-600 rounded-xl focus:border-sky-500/50 focus:ring-sky-500/20";
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

const fieldLabel = "text-xs font-semibold uppercase tracking-wider text-slate-400";

export default function Register() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [showOtp, setShowOtp] = useState(false);
  const [otpCode, setOtpCode] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    if (password !== confirmPassword) { setError("Passwords do not match"); return; }
    if (password.length < 8) { setError("Password must be at least 8 characters"); return; }
    setLoading(true);
    try {
      await base44.auth.register({ email, password });
      setShowOtp(true);
    } catch (err) {
      setError(err.message || "Registration failed");
    } finally { setLoading(false); }
  };

  const handleVerify = async () => {
    setError("");
    setLoading(true);
    try {
      const result = await base44.auth.verifyOtp({ email, otpCode });
      if (result?.access_token) base44.auth.setToken(result.access_token);
      window.location.href = "/";
    } catch (err) {
      setError(err.message || "Invalid verification code");
    } finally { setLoading(false); }
  };

  const handleResend = async () => {
    setError("");
    try {
      await base44.auth.resendOtp(email);
      toast({ title: "Code sent", description: "Check your email for the new code." });
    } catch (err) {
      setError(err.message || "Failed to resend code");
    }
  };

  const handleGoogle = () => base44.auth.loginWithProvider("google", "/");

  if (showOtp) {
    return (
      <AuthLayout
        icon={ShieldCheck}
        title="Verify your email"
        subtitle={`We sent a 6-digit code to ${email}`}
      >
        {error && (
          <div className="mb-5 p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-sm font-medium">{error}</div>
        )}
        <div className="flex justify-center mb-6">
          <InputOTP maxLength={6} value={otpCode} onChange={setOtpCode} autoFocus autoComplete="one-time-code">
            <InputOTPGroup className="gap-2">
              {[0, 1, 2, 3, 4, 5].map(i => (
                <InputOTPSlot
                  key={i}
                  index={i}
                  className="w-12 h-14 rounded-xl bg-slate-900/60 border-slate-700/50 text-slate-100 text-lg font-bold first:rounded-xl last:rounded-xl"
                />
              ))}
            </InputOTPGroup>
          </InputOTP>
        </div>
        <Button
          className="w-full h-12 font-semibold rounded-xl text-sm tracking-wide"
          style={{ background: 'linear-gradient(135deg, #0284c7, #0369a1)', border: '1px solid rgba(56,189,248,0.3)', boxShadow: '0 4px 14px rgba(2,132,199,0.25)' }}
          onClick={handleVerify}
          disabled={loading || otpCode.length < 6}
        >
          {loading ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Verifying…</> : "Verify"}
        </Button>
        <p className="text-center text-sm text-slate-400 mt-5">
          Didn't receive the code?{" "}
          <button onClick={handleResend} className="text-sky-400 font-semibold hover:text-sky-300 transition-colors">Resend</button>
        </p>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout
      icon={UserPlus}
      title="Create your account"
      subtitle="Join MyWeatherUK"
      footer={
        <>
          Already have an account?{" "}
          <Link to="/login" className="text-sky-400 font-semibold hover:text-sky-300 transition-colors">Log in</Link>
        </>
      }
    >
      <Button
        variant="outline"
        className="w-full h-12 text-sm font-semibold mb-6 bg-transparent border-slate-700/50 text-slate-200 hover:bg-slate-800/50 hover:border-slate-600"
        onClick={handleGoogle}
      >
        <GoogleIcon className="w-5 h-5 mr-2" />
        Continue with Google
      </Button>

      <div className="relative mb-6">
        <div className="absolute inset-0 flex items-center"><div className="w-full border-t border-slate-700/60" /></div>
        <div className="relative flex justify-center text-xs uppercase tracking-wider">
          <span className="bg-[#111a2c] px-3 text-slate-500">or</span>
        </div>
      </div>

      {error && (
        <div className="mb-5 p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-sm font-medium">{error}</div>
      )}

      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="space-y-1.5">
          <label htmlFor="email" className={fieldLabel}>Email</label>
          <div className="relative">
            <Mail className={iconClass} aria-hidden="true" />
            <Input id="email" type="email" autoComplete="email" autoFocus placeholder="you@example.com"
              value={email} onChange={e => setEmail(e.target.value)} className={inputClass} required />
          </div>
        </div>

        <div className="space-y-1.5">
          <label htmlFor="password" className={fieldLabel}>Password</label>
          <div className="relative">
            <Lock className={iconClass} aria-hidden="true" />
            <Input id="password" type={showPassword ? "text" : "password"} autoComplete="new-password" placeholder="••••••••"
              value={password} onChange={e => setPassword(e.target.value)} className={`${inputClass} pr-12`} required />
            <button type="button" onClick={() => setShowPassword(v => !v)}
              className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300 transition-colors" tabIndex={-1}>
              {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>
          <PasswordStrength password={password} />
        </div>

        <div className="space-y-1.5">
          <label htmlFor="confirm" className={fieldLabel}>Confirm Password</label>
          <div className="relative">
            <Lock className={iconClass} aria-hidden="true" />
            <Input id="confirm" type={showConfirm ? "text" : "password"} autoComplete="new-password" placeholder="••••••••"
              value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} className={`${inputClass} pr-12`} required />
            <button type="button" onClick={() => setShowConfirm(v => !v)}
              className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300 transition-colors" tabIndex={-1}>
              {showConfirm ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>
          {confirmPassword && password !== confirmPassword && (
            <p className="text-[10px] font-medium text-red-400 mt-1">Passwords do not match</p>
          )}
        </div>

        <Button type="submit" className="w-full h-12 font-semibold rounded-xl text-sm tracking-wide"
          style={{ background: 'linear-gradient(135deg, #0284c7, #0369a1)', border: '1px solid rgba(56,189,248,0.3)', boxShadow: '0 4px 14px rgba(2,132,199,0.25)' }}
          disabled={loading}>
          {loading ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Creating account…</> : "Create account"}
        </Button>
      </form>
    </AuthLayout>
  );
}