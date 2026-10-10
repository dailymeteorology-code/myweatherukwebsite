import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Plus, Pencil, Trash2, Loader2, Tag, Users, Zap, Crown, Star, Code2, X, ChevronUp, ChevronDown, Check } from 'lucide-react';
import { format } from 'date-fns';

const TIERS = [
  { value: 'free', label: 'Free', icon: Star },
  { value: 'lite', label: 'Lite', icon: Zap },
  { value: 'pro', label: 'Pro', icon: Crown },
  { value: 'developer', label: 'Developer', icon: Code2 },
];

// ── Plans Tab ─────────────────────────────────────────────────────────────────
function PlansTab() {
  const qc = useQueryClient();
  const [editing, setEditing] = useState(null); // null = list, 'new' = new form, id = edit
  const [form, setForm] = useState({
    name: '', tier: 'lite', price_monthly: '', yearly_discount_percent: 20,
    features: [''], badge_text: '', color: 'sky', sort_order: 0,
    stripe_payment_link_monthly: '', stripe_payment_link_yearly: '', is_active: true,
  });

  const { data: plans = [], isLoading } = useQuery({
    queryKey: ['adminPlans'],
    queryFn: () => base44.entities.SubscriptionPlan.list('sort_order'),
  });

  const saveMutation = useMutation({
    mutationFn: (data) => editing === 'new'
      ? base44.entities.SubscriptionPlan.create(data)
      : base44.entities.SubscriptionPlan.update(editing, data),
    onSuccess: () => { qc.invalidateQueries(['adminPlans']); qc.invalidateQueries(['subscriptionPlans']); setEditing(null); },
  });

  const deleteMutation = useMutation({
    onMutate: async (id) => {
      await qc.cancelQueries({ queryKey: ['adminPlans'] });
      const previous = qc.getQueryData(['adminPlans']);
      qc.setQueryData(['adminPlans'], (old = []) => old.filter(p => p.id !== id));
      return { previous };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.previous) qc.setQueryData(['adminPlans'], ctx.previous);
    },
    mutationFn: (id) => base44.entities.SubscriptionPlan.delete(id),
    onSuccess: () => qc.invalidateQueries(['adminPlans']),
  });

  const openNew = () => {
    setForm({ name: '', tier: 'lite', price_monthly: '', yearly_discount_percent: 20, features: [''], badge_text: '', color: 'sky', sort_order: plans.length, stripe_payment_link_monthly: '', stripe_payment_link_yearly: '', is_active: true });
    setEditing('new');
  };

  const openEdit = (plan) => {
    setForm({
      name: plan.name || '', tier: plan.tier || 'lite',
      price_monthly: plan.price_monthly ?? '',
      yearly_discount_percent: plan.yearly_discount_percent ?? 20,
      features: plan.features?.length ? plan.features : [''],
      badge_text: plan.badge_text || '', color: plan.color || 'sky',
      sort_order: plan.sort_order ?? 0,
      stripe_payment_link_monthly: plan.stripe_payment_link_monthly || '',
      stripe_payment_link_yearly: plan.stripe_payment_link_yearly || '',
      is_active: plan.is_active !== false,
    });
    setEditing(plan.id);
  };

  const addFeature = () => setForm(f => ({ ...f, features: [...f.features, ''] }));
  const updateFeature = (i, v) => setForm(f => { const arr = [...f.features]; arr[i] = v; return { ...f, features: arr }; });
  const removeFeature = (i) => setForm(f => ({ ...f, features: f.features.filter((_, idx) => idx !== i) }));
  const moveFeature = (i, dir) => {
    setForm(f => {
      const arr = [...f.features];
      const j = i + dir;
      if (j < 0 || j >= arr.length) return f;
      [arr[i], arr[j]] = [arr[j], arr[i]];
      return { ...f, features: arr };
    });
  };

  const handleSave = () => {
    const data = { ...form, price_monthly: parseFloat(form.price_monthly) || 0, features: form.features.filter(f => f.trim()) };
    saveMutation.mutate(data);
  };

  if (editing) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{editing === 'new' ? 'New Plan' : 'Edit Plan'}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>Plan Name</Label>
              <Input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="Pro" />
            </div>
            <div>
              <Label>Tier</Label>
              <Select value={form.tier} onValueChange={v => setForm(f => ({ ...f, tier: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {TIERS.map(t => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Monthly Price (£)</Label>
              <Input type="number" step="0.01" value={form.price_monthly} onChange={e => setForm(f => ({ ...f, price_monthly: e.target.value }))} placeholder="3.99" />
            </div>
            <div>
              <Label>Yearly Discount %</Label>
              <Input type="number" value={form.yearly_discount_percent} onChange={e => setForm(f => ({ ...f, yearly_discount_percent: parseFloat(e.target.value) || 0 }))} />
            </div>
            <div>
              <Label>Badge Text (optional)</Label>
              <Input value={form.badge_text} onChange={e => setForm(f => ({ ...f, badge_text: e.target.value }))} placeholder="Popular" />
            </div>
            <div>
              <Label>Sort Order</Label>
              <Input type="number" value={form.sort_order} onChange={e => setForm(f => ({ ...f, sort_order: parseInt(e.target.value) || 0 }))} />
            </div>
          </div>

          <div>
            <Label>Stripe Monthly Payment Link</Label>
            <Input value={form.stripe_payment_link_monthly} onChange={e => setForm(f => ({ ...f, stripe_payment_link_monthly: e.target.value }))} placeholder="https://buy.stripe.com/..." />
          </div>
          <div>
            <Label>Stripe Yearly Payment Link</Label>
            <Input value={form.stripe_payment_link_yearly} onChange={e => setForm(f => ({ ...f, stripe_payment_link_yearly: e.target.value }))} placeholder="https://buy.stripe.com/..." />
          </div>

          <div>
            <div className="flex items-center justify-between mb-2">
              <Label>Features</Label>
              <Button type="button" size="sm" variant="outline" onClick={addFeature}><Plus className="w-3 h-3 mr-1" />Add</Button>
            </div>
            <div className="space-y-2">
              {form.features.map((feat, i) => (
                <div key={i} className="flex items-center gap-2">
                  <div className="flex flex-col gap-0.5">
                    <button type="button" onClick={() => moveFeature(i, -1)} disabled={i === 0} className="text-slate-400 hover:text-white disabled:opacity-20"><ChevronUp className="w-3 h-3" /></button>
                    <button type="button" onClick={() => moveFeature(i, 1)} disabled={i === form.features.length - 1} className="text-slate-400 hover:text-white disabled:opacity-20"><ChevronDown className="w-3 h-3" /></button>
                  </div>
                  <Input value={feat} onChange={e => updateFeature(i, e.target.value)} placeholder="Feature description" className="flex-1" />
                  <button type="button" onClick={() => removeFeature(i)} className="text-red-400 hover:text-red-300"><X className="w-4 h-4" /></button>
                </div>
              ))}
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Switch checked={form.is_active} onCheckedChange={v => setForm(f => ({ ...f, is_active: v }))} />
            <Label>Active (visible to users)</Label>
          </div>

          <div className="flex gap-2 pt-2">
            <Button variant="outline" onClick={() => setEditing(null)}>Cancel</Button>
            <Button onClick={handleSave} disabled={saveMutation.isPending} className="bg-sky-600 hover:bg-sky-700">
              {saveMutation.isPending && <Loader2 className="w-4 h-4 animate-spin mr-2" />}
              Save Plan
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div>
      <div className="flex justify-between items-center mb-4">
        <p className="text-slate-500 text-sm">Manage your subscription tiers, pricing and features</p>
        <Button onClick={openNew} className="bg-sky-600 hover:bg-sky-700"><Plus className="w-4 h-4 mr-2" />New Plan</Button>
      </div>
      {isLoading ? <div className="py-8 text-center"><Loader2 className="w-6 h-6 animate-spin mx-auto" /></div> : (
        <div className="space-y-3">
          {plans.map(plan => {
            const TierIcon = TIERS.find(t => t.value === plan.tier)?.icon || Star;
            return (
              <Card key={plan.id} className={!plan.is_active ? 'opacity-50' : ''}>
                <CardContent className="p-4 flex items-start justify-between gap-4">
                  <div className="flex items-start gap-3 flex-1">
                    <div className="p-2 rounded-lg bg-slate-100"><TierIcon className="w-4 h-4" /></div>
                    <div className="flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <h3 className="font-semibold">{plan.name}</h3>
                        <Badge variant="outline" className="text-xs">{plan.tier}</Badge>
                        {plan.badge_text && <Badge className="bg-sky-500 text-white text-xs">{plan.badge_text}</Badge>}
                        {!plan.is_active && <Badge variant="outline" className="text-slate-400 text-xs">Inactive</Badge>}
                      </div>
                      <p className="text-sm text-slate-600 mt-1">
                        {plan.price_monthly ? `£${plan.price_monthly}/mo` : 'Free'} · {plan.features?.length || 0} features
                      </p>
                      {plan.stripe_payment_link_monthly && <p className="text-xs text-green-600 mt-1 flex items-center gap-1"><Check className="w-3 h-3" />Payment links configured</p>}
                    </div>
                  </div>
                  <div className="flex gap-2 shrink-0">
                    <Button size="icon" variant="ghost" onClick={() => openEdit(plan)}><Pencil className="w-4 h-4" /></Button>
                    <Button size="icon" variant="ghost" onClick={() => deleteMutation.mutate(plan.id)}><Trash2 className="w-4 h-4 text-red-500" /></Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
          {plans.length === 0 && (
            <Card><CardContent className="py-8 text-center text-slate-500">No plans configured. Create one to get started.</CardContent></Card>
          )}
        </div>
      )}
    </div>
  );
}

// ── Sales Tab ─────────────────────────────────────────────────────────────────
function SalesTab() {
  const qc = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState({ title: '', description: '', discount_percent: '', applies_to_tiers: [], selected_user_emails: [], starts_at: '', ends_at: '', show_countdown: true, is_active: true });
  const [emailInput, setEmailInput] = useState('');

  const { data: sales = [] } = useQuery({
    queryKey: ['adminSales'],
    queryFn: () => base44.entities.SubscriptionSale.list('-created_date'),
  });

  const saveMutation = useMutation({
    mutationFn: (data) => editingId
      ? base44.entities.SubscriptionSale.update(editingId, data)
      : base44.entities.SubscriptionSale.create(data),
    onSuccess: () => { qc.invalidateQueries(['adminSales']); qc.invalidateQueries(['subscriptionSales']); resetForm(); },
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => base44.entities.SubscriptionSale.delete(id),
    onSuccess: () => qc.invalidateQueries(['adminSales']),
  });

  const resetForm = () => { setForm({ title: '', description: '', discount_percent: '', applies_to_tiers: [], selected_user_emails: [], starts_at: '', ends_at: '', show_countdown: true, is_active: true }); setEditingId(null); setShowForm(false); };

  const openEdit = (s) => {
    setForm({ title: s.title || '', description: s.description || '', discount_percent: s.discount_percent || '', applies_to_tiers: s.applies_to_tiers || [], selected_user_emails: s.selected_user_emails || [], starts_at: s.starts_at ? s.starts_at.slice(0, 16) : '', ends_at: s.ends_at ? s.ends_at.slice(0, 16) : '', show_countdown: s.show_countdown !== false, is_active: s.is_active !== false });
    setEditingId(s.id); setShowForm(true);
  };

  const toggleTier = (t) => setForm(f => ({ ...f, applies_to_tiers: f.applies_to_tiers.includes(t) ? f.applies_to_tiers.filter(x => x !== t) : [...f.applies_to_tiers, t] }));
  const addEmail = () => { const e = emailInput.trim(); if (e && !form.selected_user_emails.includes(e)) { setForm(f => ({ ...f, selected_user_emails: [...f.selected_user_emails, e] })); setEmailInput(''); } };
  const removeEmail = (e) => setForm(f => ({ ...f, selected_user_emails: f.selected_user_emails.filter(x => x !== e) }));

  return (
    <div>
      <div className="flex justify-between items-center mb-4">
        <p className="text-slate-500 text-sm">Create limited-time sales and assign to specific users</p>
        <Button onClick={() => { resetForm(); setShowForm(true); }} className="bg-sky-600 hover:bg-sky-700"><Plus className="w-4 h-4 mr-2" />New Sale</Button>
      </div>

      <AnimatePresence>
        {showForm && (
          <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
            <Card className="mb-4">
              <CardHeader><CardTitle>{editingId ? 'Edit Sale' : 'New Sale'}</CardTitle></CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label>Sale Title</Label>
                    <Input value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} placeholder="Summer Sale" />
                  </div>
                  <div>
                    <Label>Discount %</Label>
                    <Input type="number" value={form.discount_percent} onChange={e => setForm(f => ({ ...f, discount_percent: parseFloat(e.target.value) || 0 }))} placeholder="25" />
                  </div>
                  <div>
                    <Label>Starts At</Label>
                    <Input type="datetime-local" value={form.starts_at} onChange={e => setForm(f => ({ ...f, starts_at: e.target.value }))} />
                  </div>
                  <div>
                    <Label>Ends At</Label>
                    <Input type="datetime-local" value={form.ends_at} onChange={e => setForm(f => ({ ...f, ends_at: e.target.value }))} />
                  </div>
                </div>
                <div>
                  <Label>Description (optional)</Label>
                  <Input value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} placeholder="Limited time offer!" />
                </div>
                <div>
                  <Label className="mb-2 block">Applies to Tiers (empty = all)</Label>
                  <div className="flex gap-2 flex-wrap">
                    {TIERS.filter(t => t.value !== 'free').map(t => (
                      <button key={t.value} type="button" onClick={() => toggleTier(t.value)}
                        className={`px-3 py-1 rounded-full text-sm border transition-colors ${form.applies_to_tiers.includes(t.value) ? 'bg-sky-600 border-sky-600 text-white' : 'border-slate-300 text-slate-600 hover:border-sky-400'}`}>
                        {t.label}
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <Label>Specific Users (empty = everyone)</Label>
                  <div className="flex gap-2 mt-1">
                    <Input value={emailInput} onChange={e => setEmailInput(e.target.value)} placeholder="user@email.com" onKeyDown={e => e.key === 'Enter' && addEmail()} />
                    <Button type="button" variant="outline" onClick={addEmail}>Add</Button>
                  </div>
                  <div className="flex flex-wrap gap-2 mt-2">
                    {form.selected_user_emails.map(em => (
                      <Badge key={em} className="bg-slate-700 text-slate-200 gap-1">
                        {em}<button onClick={() => removeEmail(em)}><X className="w-3 h-3" /></button>
                      </Badge>
                    ))}
                  </div>
                </div>
                <div className="flex items-center gap-4">
                  <div className="flex items-center gap-2">
                    <Switch checked={form.show_countdown} onCheckedChange={v => setForm(f => ({ ...f, show_countdown: v }))} />
                    <Label>Show countdown on subscription page</Label>
                  </div>
                  <div className="flex items-center gap-2">
                    <Switch checked={form.is_active} onCheckedChange={v => setForm(f => ({ ...f, is_active: v }))} />
                    <Label>Active</Label>
                  </div>
                </div>
                <div className="flex gap-2">
                  <Button variant="outline" onClick={resetForm}>Cancel</Button>
                  <Button onClick={() => saveMutation.mutate({ ...form, discount_percent: parseFloat(form.discount_percent) || 0 })} disabled={saveMutation.isPending} className="bg-sky-600 hover:bg-sky-700">
                    {saveMutation.isPending && <Loader2 className="w-4 h-4 animate-spin mr-2" />}Save
                  </Button>
                </div>
              </CardContent>
            </Card>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="space-y-3">
        {sales.map(s => {
          const now = new Date();
          const expired = s.ends_at && new Date(s.ends_at) < now;
          return (
            <Card key={s.id} className={(!s.is_active || expired) ? 'opacity-60' : ''}>
              <CardContent className="p-4 flex items-start justify-between gap-4">
                <div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <h3 className="font-semibold">{s.title}</h3>
                    <Badge className="bg-green-500 text-white">{s.discount_percent}% OFF</Badge>
                    {expired && <Badge variant="outline" className="text-red-500 border-red-500">Expired</Badge>}
                    {!s.is_active && <Badge variant="outline" className="text-slate-400">Inactive</Badge>}
                  </div>
                  <p className="text-sm text-slate-500 mt-1">
                    {s.starts_at && `From ${format(new Date(s.starts_at), 'dd MMM HH:mm')} `}
                    {s.ends_at && `Until ${format(new Date(s.ends_at), 'dd MMM HH:mm yyyy')}`}
                    {!s.ends_at && 'No end date'}
                  </p>
                  {s.selected_user_emails?.length > 0 && <p className="text-xs text-slate-400 mt-1">{s.selected_user_emails.length} specific users</p>}
                </div>
                <div className="flex gap-2 shrink-0">
                  <Button size="icon" variant="ghost" onClick={() => openEdit(s)}><Pencil className="w-4 h-4" /></Button>
                  <Button size="icon" variant="ghost" onClick={() => deleteMutation.mutate(s.id)}><Trash2 className="w-4 h-4 text-red-500" /></Button>
                </div>
              </CardContent>
            </Card>
          );
        })}
        {sales.length === 0 && <Card><CardContent className="py-8 text-center text-slate-500">No sales yet.</CardContent></Card>}
      </div>
    </div>
  );
}

// ── Coupons Tab ───────────────────────────────────────────────────────────────
function CouponsTab() {
  const qc = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState({ code: '', description: '', discount_percent: '', applies_to_tiers: [], expires_at: '', max_uses: 0, is_active: true });

  const { data: coupons = [] } = useQuery({
    queryKey: ['adminCoupons'],
    queryFn: () => base44.entities.SubscriptionCoupon.list('-created_date'),
  });

  const saveMutation = useMutation({
    mutationFn: (data) => editingId
      ? base44.entities.SubscriptionCoupon.update(editingId, data)
      : base44.entities.SubscriptionCoupon.create(data),
    onSuccess: () => { qc.invalidateQueries(['adminCoupons']); qc.invalidateQueries(['subscriptionCoupons']); resetForm(); },
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => base44.entities.SubscriptionCoupon.delete(id),
    onSuccess: () => qc.invalidateQueries(['adminCoupons']),
  });

  const resetForm = () => { setForm({ code: '', description: '', discount_percent: '', applies_to_tiers: [], expires_at: '', max_uses: 0, is_active: true }); setEditingId(null); setShowForm(false); };
  const openEdit = (c) => { setForm({ code: c.code || '', description: c.description || '', discount_percent: c.discount_percent || '', applies_to_tiers: c.applies_to_tiers || [], expires_at: c.expires_at ? c.expires_at.slice(0, 16) : '', max_uses: c.max_uses ?? 0, is_active: c.is_active !== false }); setEditingId(c.id); setShowForm(true); };
  const toggleTier = (t) => setForm(f => ({ ...f, applies_to_tiers: f.applies_to_tiers.includes(t) ? f.applies_to_tiers.filter(x => x !== t) : [...f.applies_to_tiers, t] }));

  return (
    <div>
      <div className="flex justify-between items-center mb-4">
        <p className="text-slate-500 text-sm">Create coupon codes for special deals</p>
        <Button onClick={() => { resetForm(); setShowForm(true); }} className="bg-sky-600 hover:bg-sky-700"><Plus className="w-4 h-4 mr-2" />New Coupon</Button>
      </div>

      <AnimatePresence>
        {showForm && (
          <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
            <Card className="mb-4">
              <CardHeader><CardTitle>{editingId ? 'Edit Coupon' : 'New Coupon'}</CardTitle></CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label>Coupon Code</Label>
                    <Input value={form.code} onChange={e => setForm(f => ({ ...f, code: e.target.value.toUpperCase() }))} placeholder="SUMMER25" className="font-mono uppercase" />
                  </div>
                  <div>
                    <Label>Discount %</Label>
                    <Input type="number" value={form.discount_percent} onChange={e => setForm(f => ({ ...f, discount_percent: parseFloat(e.target.value) || 0 }))} placeholder="25" />
                  </div>
                  <div>
                    <Label>Expires At</Label>
                    <Input type="datetime-local" value={form.expires_at} onChange={e => setForm(f => ({ ...f, expires_at: e.target.value }))} />
                  </div>
                  <div>
                    <Label>Max Uses (0 = unlimited)</Label>
                    <Input type="number" value={form.max_uses} onChange={e => setForm(f => ({ ...f, max_uses: parseInt(e.target.value) || 0 }))} />
                  </div>
                </div>
                <div>
                  <Label>Description (optional)</Label>
                  <Input value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} placeholder="Special launch discount" />
                </div>
                <div>
                  <Label className="mb-2 block">Applies to Tiers (empty = all)</Label>
                  <div className="flex gap-2 flex-wrap">
                    {TIERS.filter(t => t.value !== 'free').map(t => (
                      <button key={t.value} type="button" onClick={() => toggleTier(t.value)}
                        className={`px-3 py-1 rounded-full text-sm border transition-colors ${form.applies_to_tiers.includes(t.value) ? 'bg-sky-600 border-sky-600 text-white' : 'border-slate-300 text-slate-600 hover:border-sky-400'}`}>
                        {t.label}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Switch checked={form.is_active} onCheckedChange={v => setForm(f => ({ ...f, is_active: v }))} />
                  <Label>Active</Label>
                </div>
                <div className="flex gap-2">
                  <Button variant="outline" onClick={resetForm}>Cancel</Button>
                  <Button onClick={() => saveMutation.mutate({ ...form, discount_percent: parseFloat(form.discount_percent) || 0, max_uses: parseInt(form.max_uses) || 0 })} disabled={saveMutation.isPending} className="bg-sky-600 hover:bg-sky-700">
                    {saveMutation.isPending && <Loader2 className="w-4 h-4 animate-spin mr-2" />}Save
                  </Button>
                </div>
              </CardContent>
            </Card>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="space-y-3">
        {coupons.map(c => {
          const expired = c.expires_at && new Date(c.expires_at) < new Date();
          return (
            <Card key={c.id} className={(!c.is_active || expired) ? 'opacity-60' : ''}>
              <CardContent className="p-4 flex items-start justify-between gap-4">
                <div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-mono font-bold text-lg">{c.code}</span>
                    <Badge className="bg-sky-500 text-white">{c.discount_percent}% OFF</Badge>
                    {expired && <Badge variant="outline" className="text-red-500 border-red-500">Expired</Badge>}
                    {!c.is_active && <Badge variant="outline" className="text-slate-400">Inactive</Badge>}
                  </div>
                  {c.description && <p className="text-sm text-slate-500 mt-1">{c.description}</p>}
                  <p className="text-xs text-slate-400 mt-1">
                    {c.expires_at ? `Expires ${format(new Date(c.expires_at), 'dd MMM yyyy HH:mm')}` : 'No expiry'}
                    {' · '}
                    {c.max_uses ? `${c.uses_count || 0}/${c.max_uses} uses` : 'Unlimited uses'}
                  </p>
                </div>
                <div className="flex gap-2 shrink-0">
                  <Button size="icon" variant="ghost" onClick={() => openEdit(c)}><Pencil className="w-4 h-4" /></Button>
                  <Button size="icon" variant="ghost" onClick={() => deleteMutation.mutate(c.id)}><Trash2 className="w-4 h-4 text-red-500" /></Button>
                </div>
              </CardContent>
            </Card>
          );
        })}
        {coupons.length === 0 && <Card><CardContent className="py-8 text-center text-slate-500">No coupons yet.</CardContent></Card>}
      </div>
    </div>
  );
}

// ── Subscribers Tab ───────────────────────────────────────────────────────────
function SubscribersTab() {
  const qc = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState({ user_email: '', user_name: '', plan_tier: 'lite', billing_cycle: 'monthly', status: 'active', starts_at: '', expires_at: '', notes: '' });

  const { data: subscribers = [] } = useQuery({
    queryKey: ['adminSubscribers'],
    queryFn: () => base44.entities.UserSubscription.list('-created_date'),
  });

  const saveMutation = useMutation({
    // Optimistic: update the subscriber card's status/tier badge immediately.
    onMutate: async (data) => {
      if (!editingId) return; // no optimistic update for creates
      await qc.cancelQueries({ queryKey: ['adminSubscribers'] });
      const previous = qc.getQueryData(['adminSubscribers']);
      qc.setQueryData(['adminSubscribers'], (old = []) =>
        old.map(s => s.id === editingId ? { ...s, ...data } : s)
      );
      return { previous };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.previous) qc.setQueryData(['adminSubscribers'], ctx.previous);
    },
    mutationFn: (data) => editingId
      ? base44.entities.UserSubscription.update(editingId, data)
      : base44.entities.UserSubscription.create(data),
    onSuccess: () => { qc.invalidateQueries(['adminSubscribers']); resetForm(); },
  });

  const deleteMutation = useMutation({
    // Optimistic: remove the row immediately.
    onMutate: async (id) => {
      await qc.cancelQueries({ queryKey: ['adminSubscribers'] });
      const previous = qc.getQueryData(['adminSubscribers']);
      qc.setQueryData(['adminSubscribers'], (old = []) => old.filter(s => s.id !== id));
      return { previous };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.previous) qc.setQueryData(['adminSubscribers'], ctx.previous);
    },
    mutationFn: (id) => base44.entities.UserSubscription.delete(id),
    onSuccess: () => qc.invalidateQueries(['adminSubscribers']),
  });

  const resetForm = () => { setForm({ user_email: '', user_name: '', plan_tier: 'lite', billing_cycle: 'monthly', status: 'active', starts_at: '', expires_at: '', notes: '' }); setEditingId(null); setShowForm(false); };
  const openEdit = (s) => { setForm({ user_email: s.user_email || '', user_name: s.user_name || '', plan_tier: s.plan_tier || 'lite', billing_cycle: s.billing_cycle || 'monthly', status: s.status || 'active', starts_at: s.starts_at ? s.starts_at.slice(0, 10) : '', expires_at: s.expires_at ? s.expires_at.slice(0, 10) : '', notes: s.notes || '' }); setEditingId(s.id); setShowForm(true); };

  const statusColors = { active: 'bg-green-100 text-green-800', cancelled: 'bg-red-100 text-red-800', expired: 'bg-slate-100 text-slate-600', pending: 'bg-yellow-100 text-yellow-800' };
  const TierIcon = TIERS.find(t => t.value === form.plan_tier)?.icon || Star;

  return (
    <div>
      <div className="flex justify-between items-center mb-4">
        <p className="text-slate-500 text-sm">Manage user subscriptions manually</p>
        <Button onClick={() => { resetForm(); setShowForm(true); }} className="bg-sky-600 hover:bg-sky-700"><Plus className="w-4 h-4 mr-2" />Add Subscriber</Button>
      </div>

      <AnimatePresence>
        {showForm && (
          <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
            <Card className="mb-4">
              <CardHeader><CardTitle>{editingId ? 'Edit Subscription' : 'Add Subscription'}</CardTitle></CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label>User Email</Label>
                    <Input value={form.user_email} onChange={e => setForm(f => ({ ...f, user_email: e.target.value }))} placeholder="user@example.com" />
                  </div>
                  <div>
                    <Label>Display Name</Label>
                    <Input value={form.user_name} onChange={e => setForm(f => ({ ...f, user_name: e.target.value }))} placeholder="John Doe" />
                  </div>
                  <div>
                    <Label>Plan</Label>
                    <Select value={form.plan_tier} onValueChange={v => setForm(f => ({ ...f, plan_tier: v }))}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>{TIERS.map(t => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label>Billing Cycle</Label>
                    <Select value={form.billing_cycle} onValueChange={v => setForm(f => ({ ...f, billing_cycle: v }))}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="monthly">Monthly</SelectItem>
                        <SelectItem value="yearly">Yearly</SelectItem>
                        <SelectItem value="one_time">One Time</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label>Status</Label>
                    <Select value={form.status} onValueChange={v => setForm(f => ({ ...f, status: v }))}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="active">Active</SelectItem>
                        <SelectItem value="cancelled">Cancelled</SelectItem>
                        <SelectItem value="expired">Expired</SelectItem>
                        <SelectItem value="pending">Pending</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div></div>
                  <div>
                    <Label>Starts At</Label>
                    <Input type="date" value={form.starts_at} onChange={e => setForm(f => ({ ...f, starts_at: e.target.value }))} />
                  </div>
                  <div>
                    <Label>Expires At</Label>
                    <Input type="date" value={form.expires_at} onChange={e => setForm(f => ({ ...f, expires_at: e.target.value }))} />
                  </div>
                </div>
                <div>
                  <Label>Admin Notes</Label>
                  <Input value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} placeholder="Any notes..." />
                </div>
                <div className="flex gap-2">
                  <Button variant="outline" onClick={resetForm}>Cancel</Button>
                  <Button onClick={() => saveMutation.mutate(form)} disabled={saveMutation.isPending} className="bg-sky-600 hover:bg-sky-700">
                    {saveMutation.isPending && <Loader2 className="w-4 h-4 animate-spin mr-2" />}Save
                  </Button>
                </div>
              </CardContent>
            </Card>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="space-y-3">
        {subscribers.map(s => {
          const SIcon = TIERS.find(t => t.value === s.plan_tier)?.icon || Star;
          return (
            <Card key={s.id}>
              <CardContent className="p-4 flex items-start justify-between gap-4">
                <div className="flex items-start gap-3">
                  <div className="p-2 rounded-lg bg-slate-100"><SIcon className="w-4 h-4" /></div>
                  <div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold text-sm">{s.user_email}</span>
                      <Badge className={statusColors[s.status] || statusColors.active}>{s.status}</Badge>
                      <Badge variant="outline" className="text-xs">{s.plan_tier}</Badge>
                    </div>
                    {s.user_name && <p className="text-xs text-slate-500 mt-0.5">{s.user_name}</p>}
                    <p className="text-xs text-slate-400 mt-1">
                      {s.billing_cycle}
                      {s.expires_at && ` · Expires ${format(new Date(s.expires_at), 'dd MMM yyyy')}`}
                    </p>
                    {s.notes && <p className="text-xs text-slate-400 italic mt-1">{s.notes}</p>}
                  </div>
                </div>
                <div className="flex gap-2 shrink-0">
                  <Button size="icon" variant="ghost" onClick={() => openEdit(s)}><Pencil className="w-4 h-4" /></Button>
                  <Button size="icon" variant="ghost" onClick={() => deleteMutation.mutate(s.id)}><Trash2 className="w-4 h-4 text-red-500" /></Button>
                </div>
              </CardContent>
            </Card>
          );
        })}
        {subscribers.length === 0 && <Card><CardContent className="py-8 text-center text-slate-500">No subscribers yet.</CardContent></Card>}
      </div>
    </div>
  );
}

// ── Main Export ───────────────────────────────────────────────────────────────
export default function SubscriptionManagementTab() {
  return (
    <div>
      <div className="flex items-center gap-3 mb-6">
        <div className="p-3 rounded-xl bg-sky-100"><Crown className="w-5 h-5 text-sky-600" /></div>
        <div>
          <h2 className="text-xl font-bold text-slate-800">Subscriptions</h2>
          <p className="text-slate-500 text-sm">Manage plans, sales, coupons and subscribers</p>
        </div>
      </div>
      <Tabs defaultValue="plans">
        <TabsList className="mb-4">
          <TabsTrigger value="plans">Plans</TabsTrigger>
          <TabsTrigger value="sales">Sales</TabsTrigger>
          <TabsTrigger value="coupons">Coupons</TabsTrigger>
          <TabsTrigger value="subscribers">Subscribers</TabsTrigger>
        </TabsList>
        <TabsContent value="plans"><PlansTab /></TabsContent>
        <TabsContent value="sales"><SalesTab /></TabsContent>
        <TabsContent value="coupons"><CouponsTab /></TabsContent>
        <TabsContent value="subscribers"><SubscribersTab /></TabsContent>
      </Tabs>
    </div>
  );
}