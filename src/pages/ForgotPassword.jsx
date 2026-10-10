import React, { useState } from "react";
import { Link } from "react-router-dom";
import { base44 } from "@/api/base44Client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Mail, ArrowLeft, Loader2, Send, CheckCircle2 } from "lucide-react";
import AuthLayout from "@/components/AuthLayout";
import { motion, AnimatePresence } from "framer-motion";

export default function ForgotPassword() {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      await base44.auth.resetPasswordRequest(email);
    } catch {
      // Always show success
    } finally {
      setLoading(false);
      setSent(true);
    }
  };

  return (
    <AuthLayout
      icon={Mail}
      title="Reset password"
      subtitle="We'll send you a link to reset it"
      footer={
        <Link to="/login" className="text-sky-400 font-semibold hover:text-sky-300 transition-colors inline-flex items-center gap-1.5">
          <ArrowLeft className="w-3.5 h-3.5" /> Back to log in
        </Link>
      }
    >
      <AnimatePresence mode="wait">
        {sent ? (
          <motion.div
            key="sent"
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.35, ease: [0.25, 0.46, 0.45, 0.94] }}
            className="text-center py-5"
          >
            <motion.div
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              transition={{ type: "spring", damping: 14, stiffness: 200, delay: 0.1 }}
              className="mx-auto w-16 h-16 rounded-full flex items-center justify-center mb-5"
              style={{ background: 'linear-gradient(135deg, rgba(16,185,129,0.15), rgba(5,150,105,0.10))', border: '1px solid rgba(16,185,129,0.25)' }}
            >
              <CheckCircle2 className="w-8 h-8 text-emerald-400" strokeWidth={2} />
            </motion.div>
            <h3 className="text-lg font-bold text-slate-100 mb-2">Check your inbox</h3>
            <p className="text-sm text-slate-400 leading-relaxed mb-6">
              If an account exists with that email, you'll receive a password reset link shortly.
            </p>
            <Button
              variant="outline"
              className="w-full h-12 text-sm font-semibold bg-transparent border-slate-700/50 text-slate-200 hover:bg-slate-800/50 hover:border-slate-600 rounded-xl"
              onClick={() => { setSent(false); setEmail(""); }}
            >
              <Send className="w-4 h-4 mr-2" /> Send to a different email
            </Button>
          </motion.div>
        ) : (
          <motion.form
            key="form"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onSubmit={handleSubmit}
            className="space-y-4"
          >
            <div className="space-y-1.5">
              <label htmlFor="email" className="text-xs font-semibold uppercase tracking-wider text-slate-400">Email address</label>
              <div className="relative">
                <Mail className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" aria-hidden="true" />
                <Input
                  id="email"
                  type="email"
                  autoComplete="email"
                  autoFocus
                  placeholder="you@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="pl-10 h-12 bg-slate-900/60 border-slate-700/50 text-slate-100 placeholder:text-slate-600 rounded-xl focus:border-sky-500/50 focus:ring-sky-500/20"
                  required
                />
              </div>
            </div>
            <Button
              type="submit"
              className="w-full h-12 font-semibold rounded-xl text-sm tracking-wide"
              style={{ background: 'linear-gradient(135deg, #0284c7, #0369a1)', border: '1px solid rgba(56,189,248,0.3)', boxShadow: '0 4px 14px rgba(2,132,199,0.25)' }}
              disabled={loading}
            >
              {loading ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Sending…</> : "Send reset link"}
            </Button>
          </motion.form>
        )}
      </AnimatePresence>
    </AuthLayout>
  );
}