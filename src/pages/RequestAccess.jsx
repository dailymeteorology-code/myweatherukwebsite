import React, { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Loader2, CheckCircle2 } from 'lucide-react';
import { useTheme } from '@/components/ThemeContext';

export default function RequestAccess() {
  const [searchParams] = useSearchParams();
  const [formData, setFormData] = useState({ full_name: '', email: '', social_media_handle: '' });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const { isDark } = useTheme();
  const token = searchParams.get('token');

  // Pull admin-controlled title/message for this page
  const { data: settings } = useQuery({
    queryKey: ['settings'],
    queryFn: async () => {
      try { const l = await base44.entities.SiteSettings.list(); return l?.[0] || null; }
      catch { return null; }
    },
    staleTime: 60_000,
  });

  const pageTitle = (settings?.disabled_title || '').trim() || 'Request Access';
  const pageMessage =
    (settings?.disabled_message || '').trim() ||
    'Fill out the form below to request access to this site.';

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    if (!formData.full_name.trim() || !formData.email.trim() || !formData.social_media_handle.trim()) {
      setError('All fields are required');
      setLoading(false);
      return;
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(formData.email)) {
      setError('Please enter a valid email');
      setLoading(false);
      return;
    }

    try {
      await base44.entities.AccessRequest.create({
        full_name: formData.full_name,
        email: formData.email,
        social_media_handle: formData.social_media_handle,
        invitation_token: token || '',
        status: 'pending'
      });

      // Send confirmation email
      await base44.integrations.Core.SendEmail({
        to: formData.email,
        subject: 'Access Request Received – MyWeather',
        body: `Hi ${formData.full_name},\n\nThanks for requesting access to MyWeather.\n\nThe website is currently unavailable to the public, but your request has been successfully submitted and is now under review by our team.\n\nWe'll notify you as soon as a decision has been made.\n\nThank you for your patience.\n\n– MyWeather Team`,
      });

      setSuccess(true);
      setFormData({ full_name: '', email: '', social_media_handle: '' });
    } catch (err) {
      setError('Failed to submit request. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className={`min-h-screen flex items-center justify-center p-4 ${isDark ? 'bg-slate-900' : 'bg-slate-50'}`}>
      <div className={`max-w-md w-full rounded-lg p-8 ${isDark ? 'bg-slate-800 border border-slate-700' : 'bg-white border border-slate-200'}`}>
        <h1 className={`text-3xl font-bold mb-2 ${isDark ? 'text-white' : 'text-slate-900'}`}>{pageTitle}</h1>
        <p className={`mb-6 whitespace-pre-line ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>
          {pageMessage}
        </p>

        {success ? (
          <div className={`p-4 rounded-lg ${isDark ? 'bg-green-500/20 border border-green-500/30' : 'bg-green-50 border border-green-200'}`}>
            <div className="flex items-start gap-3">
              <CheckCircle2 className={`w-5 h-5 mt-0.5 ${isDark ? 'text-green-400' : 'text-green-600'}`} />
              <div>
                <h3 className={`font-semibold mb-1 ${isDark ? 'text-green-400' : 'text-green-700'}`}>Request Submitted</h3>
                <p className={`text-sm ${isDark ? 'text-green-300' : 'text-green-600'}`}>
                  Your access request has been submitted. The site administrator will review your request and send you an email with the decision.
                </p>
              </div>
            </div>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            {error && (
              <div className={`p-3 rounded-lg ${isDark ? 'bg-red-500/20 border border-red-500/30' : 'bg-red-50 border border-red-200'}`}>
                <p className={`text-sm ${isDark ? 'text-red-400' : 'text-red-600'}`}>{error}</p>
              </div>
            )}

            <div>
              <label className={`block text-sm font-medium mb-1.5 ${isDark ? 'text-slate-300' : 'text-slate-700'}`}>
                Full Name *
              </label>
              <Input
                type="text"
                value={formData.full_name}
                onChange={(e) => setFormData({ ...formData, full_name: e.target.value })}
                placeholder="Your full name"
                disabled={loading}
                className={isDark ? 'bg-slate-700 border-slate-600 text-white' : ''}
              />
            </div>

            <div>
              <label className={`block text-sm font-medium mb-1.5 ${isDark ? 'text-slate-300' : 'text-slate-700'}`}>
                Email *
              </label>
              <Input
                type="email"
                value={formData.email}
                onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                placeholder="your.email@example.com"
                disabled={loading}
                className={isDark ? 'bg-slate-700 border-slate-600 text-white' : ''}
              />
            </div>

            <div>
              <label className={`block text-sm font-medium mb-1.5 ${isDark ? 'text-slate-300' : 'text-slate-700'}`}>
                Social Media Handle *
              </label>
              <Input
                type="text"
                value={formData.social_media_handle}
                onChange={(e) => setFormData({ ...formData, social_media_handle: e.target.value })}
                placeholder="@yourhandle"
                disabled={loading}
                className={isDark ? 'bg-slate-700 border-slate-600 text-white' : ''}
              />
            </div>

            <Button
              type="submit"
              disabled={loading}
              className="w-full bg-sky-600 hover:bg-sky-700 text-white"
            >
              {loading ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Submitting...
                </>
              ) : (
                'Submit Request'
              )}
            </Button>
          </form>
        )}
      </div>
    </div>
  );
}