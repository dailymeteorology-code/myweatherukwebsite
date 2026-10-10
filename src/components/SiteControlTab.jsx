import React, { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Save, Loader2, Power, Timer, Link, Palmtree, KeyRound, RefreshCw, Copy, Check } from 'lucide-react';
import { toast } from "sonner";

function generateKey() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from({ length: 12 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
}

export default function SiteControlTab() {
  const queryClient = useQueryClient();
  const [formData, setFormData] = useState({
    site_disabled: false,
    disabled_title: '',
    disabled_message: '',
    universal_access_key: '',
    countdown_enabled: false,
    countdown_target: '',
    countdown_title: '',
    countdown_description: '',
    countdown_display: 'disabled_page',
    met_office_api_key: '',
    location_search_enabled: true,
    summer_theme_enabled: false,
  });
  const [copied, setCopied] = useState(false);

  const { data: settings, isLoading } = useQuery({
    queryKey: ['settings'],
    queryFn: async () => {
      const list = await base44.entities.SiteSettings.list();
      return list[0] || null;
    },
  });

  useEffect(() => {
    if (settings) {
      setFormData({
        site_disabled: settings.site_disabled || false,
        disabled_title: settings.disabled_title || '',
        disabled_message: settings.disabled_message || '',
        universal_access_key: settings.universal_access_key || '',
        countdown_enabled: settings.countdown_enabled || false,
        countdown_target: settings.countdown_target
          ? new Date(settings.countdown_target).toISOString().slice(0, 16)
          : '',
        countdown_title: settings.countdown_title || '',
        countdown_description: settings.countdown_description || '',
        countdown_display: settings.countdown_display || 'disabled_page',
        met_office_api_key: settings.met_office_api_key || '',
        location_search_enabled: settings.location_search_enabled !== false,
        summer_theme_enabled: settings.summer_theme_enabled || false,
      });
    }
  }, [settings]);

  const save = async (data) => {
    const payload = {
      ...data,
      countdown_target: data.countdown_target ? new Date(data.countdown_target).toISOString() : '',
    };
    if (settings) {
      await base44.entities.SiteSettings.update(settings.id, payload);
    } else {
      await base44.entities.SiteSettings.create({ site_name: 'My Site', ...payload });
    }
    queryClient.invalidateQueries({ queryKey: ['settings'] });
  };

  const saveMutation = useMutation({
    mutationFn: save,
    onSuccess: () => toast.success('Saved!'),
    onError: () => toast.error('Failed to save'),
  });

  // Auto-save when a toggle is flipped
  const handleToggle = (field, value) => {
    const updated = { ...formData, [field]: value };
    setFormData(updated);
    saveMutation.mutate(updated);
  };

  const handleRegenerateKey = async () => {
    const newKey = generateKey();
    const updated = { ...formData, universal_access_key: newKey };
    setFormData(updated);
    await saveMutation.mutateAsync(updated);
    toast.success('New universal access key generated and saved.');
  };

  const handleCopyKey = () => {
    if (!formData.universal_access_key) return;
    navigator.clipboard.writeText(formData.universal_access_key).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  if (isLoading) {
    return <div className="flex justify-center py-12"><Loader2 className="w-8 h-8 animate-spin text-slate-400" /></div>;
  }

  return (
    <div className="space-y-6">
      {/* Disable Site */}
      <Card className={formData.site_disabled ? 'border-red-300 bg-red-50' : ''}>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Power className={`w-5 h-5 ${formData.site_disabled ? 'text-red-600' : 'text-slate-500'}`} />
            Disable Website
          </CardTitle>
          <CardDescription>
            When enabled, visitors will see a maintenance / request-access page. Admins are not affected.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-3">
            <Switch
              checked={formData.site_disabled}
              onCheckedChange={(v) => handleToggle('site_disabled', v)}
            />
            <Label className={formData.site_disabled ? 'text-red-700 font-semibold' : ''}>
              {formData.site_disabled ? 'Site is DISABLED — visitors see maintenance page' : 'Site is enabled'}
            </Label>
          </div>
          <div className="space-y-2">
            <Label>Page title (shown to visitors)</Label>
            <Input
              value={formData.disabled_title}
              onChange={(e) => setFormData(prev => ({ ...prev, disabled_title: e.target.value }))}
              placeholder="e.g. Coming Soon — MyWeatherUK"
            />
          </div>
          <div className="space-y-2">
            <Label>Description / message shown to visitors</Label>
            <Textarea
              value={formData.disabled_message}
              onChange={(e) => setFormData(prev => ({ ...prev, disabled_message: e.target.value }))}
              placeholder="This website is temporarily unavailable."
              rows={3}
            />
          </div>
          <Button
            onClick={() => saveMutation.mutate(formData)}
            className="w-full h-10"
            disabled={saveMutation.isPending}
          >
            {saveMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Save className="w-4 h-4 mr-2" />}
            Save
          </Button>
        </CardContent>
      </Card>

      {/* Universal Access Key */}
      <Card className="border-emerald-300">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <KeyRound className="w-5 h-5 text-emerald-600" />
            Universal Access Key
          </CardTitle>
          <CardDescription>
            A single permanent code that anyone can enter on the site-disabled page to gain access — no personal invite needed. Works for unlimited people forever.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {formData.universal_access_key ? (
            <div className="flex items-center gap-2">
              <code className="flex-1 px-4 py-3 rounded-lg bg-slate-900 text-emerald-400 font-mono text-lg font-bold tracking-[0.22em] border border-emerald-700 select-all">
                {formData.universal_access_key}
              </code>
              <Button variant="outline" size="icon" onClick={handleCopyKey} title="Copy key">
                {copied ? <Check className="w-4 h-4 text-green-600" /> : <Copy className="w-4 h-4" />}
              </Button>
            </div>
          ) : (
            <p className="text-sm text-slate-500 italic">No universal key set. Generate one below.</p>
          )}
          <Button
            onClick={handleRegenerateKey}
            variant="outline"
            className="w-full h-10 border-emerald-400 text-emerald-700 hover:bg-emerald-50"
            disabled={saveMutation.isPending}
          >
            {saveMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <RefreshCw className="w-4 h-4 mr-2" />}
            {formData.universal_access_key ? 'Regenerate Key' : 'Generate Key'}
          </Button>
          <p className="text-xs text-slate-400">Regenerating issues a brand-new key — the old one stops working immediately.</p>
        </CardContent>
      </Card>

      {/* Countdown */}
      <Card className={formData.countdown_enabled ? 'border-sky-300' : ''}>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Timer className={`w-5 h-5 ${formData.countdown_enabled ? 'text-sky-600' : 'text-slate-500'}`} />
            Countdown Timer
          </CardTitle>
          <CardDescription>
            Show a countdown page to visitors with a custom title and message.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-3">
            <Switch
              checked={formData.countdown_enabled}
              onCheckedChange={(v) => handleToggle('countdown_enabled', v)}
            />
            <Label className={formData.countdown_enabled ? 'text-sky-700 font-semibold' : ''}>
              {formData.countdown_enabled ? 'Countdown is active' : 'Countdown is off'}
            </Label>
          </div>

          {formData.countdown_enabled && (
            <div className="space-y-4 pt-2 border-t border-slate-200">
              <div className="space-y-2">
                <Label>Countdown Display Location</Label>
                <div className="flex gap-3">
                  {[{ value: 'disabled_page', label: 'Site Disabled Page' }, { value: 'homepage', label: 'Homepage' }].map(opt => (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => setFormData(prev => ({ ...prev, countdown_display: opt.value }))}
                      className={`flex-1 py-2 px-3 rounded-lg border-2 text-sm font-medium transition-all ${
                        formData.countdown_display === opt.value
                          ? 'border-sky-500 bg-sky-50 text-sky-700'
                          : 'border-slate-200 text-slate-600 hover:border-slate-300'
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>
              <div className="space-y-2">
                <Label>Countdown Target Date & Time</Label>
                <Input
                  type="datetime-local"
                  value={formData.countdown_target}
                  onChange={(e) => setFormData(prev => ({ ...prev, countdown_target: e.target.value }))}
                />
              </div>
              <div className="space-y-2">
                <Label>Title</Label>
                <Input
                  value={formData.countdown_title}
                  onChange={(e) => setFormData(prev => ({ ...prev, countdown_title: e.target.value }))}
                  placeholder="e.g., Something big is coming..."
                />
              </div>
              <div className="space-y-2">
                <Label>Description</Label>
                <Textarea
                  value={formData.countdown_description}
                  onChange={(e) => setFormData(prev => ({ ...prev, countdown_description: e.target.value }))}
                  placeholder="e.g., We're working on something exciting. Check back soon!"
                  rows={3}
                />
              </div>
              <Button
                onClick={() => saveMutation.mutate(formData)}
                className="w-full h-10 bg-sky-600 hover:bg-sky-700"
                disabled={saveMutation.isPending}
              >
                {saveMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Save className="w-4 h-4 mr-2" />}
                Save Countdown Details
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Location Search */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Link className="w-5 h-5 text-slate-500" />
            Location Search
          </CardTitle>
          <CardDescription>
            Show or hide the floating location weather search bar on the site.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-3">
            <Switch
              checked={formData.location_search_enabled}
              onCheckedChange={(v) => handleToggle('location_search_enabled', v)}
            />
            <Label className={formData.location_search_enabled ? 'text-green-700 font-semibold' : ''}>
              {formData.location_search_enabled ? 'Search bar is visible' : 'Search bar is hidden'}
            </Label>
          </div>
        </CardContent>
      </Card>

      {/* Home Page Theme */}
      <Card className={formData.summer_theme_enabled ? 'border-amber-300 bg-gradient-to-br from-amber-50 via-orange-50 to-sky-50' : ''}>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Palmtree className={`w-5 h-5 ${formData.summer_theme_enabled ? 'text-amber-600' : 'text-slate-500'}`} />
            Home Page Theme
          </CardTitle>
          <CardDescription>
            Switch the home page between the default look and a tropical summer theme.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-3">
            <Switch
              checked={formData.summer_theme_enabled}
              onCheckedChange={(v) => handleToggle('summer_theme_enabled', v)}
            />
            <Label className={formData.summer_theme_enabled ? 'text-amber-700 font-semibold' : ''}>
              {formData.summer_theme_enabled ? '☀️  Summer theme is ACTIVE' : 'Default theme is active'}
            </Label>
          </div>
        </CardContent>
      </Card>

      {/* Met Office API Key */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Link className="w-5 h-5 text-slate-500" />
            Met Office API Key
          </CardTitle>
          <CardDescription>
            Your Met Office DataHub API key, used to fetch location weather forecasts.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>API Key</Label>
            <Input
              type="password"
              value={formData.met_office_api_key}
              onChange={(e) => setFormData(prev => ({ ...prev, met_office_api_key: e.target.value }))}
              placeholder="Paste your Met Office API key here..."
            />
          </div>
          <Button
            onClick={() => saveMutation.mutate(formData)}
            className="w-full h-10"
            disabled={saveMutation.isPending}
          >
            {saveMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Save className="w-4 h-4 mr-2" />}
            Save API Key
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}