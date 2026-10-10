import React, { useState, useEffect, useRef } from 'react';
import { base44 } from '@/api/base44Client';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Megaphone, Plus, Pencil, Trash2, Loader2, AlertTriangle, Info, Bell,
  Zap, Settings, CloudSun, Layers, Crown, GripVertical, ListOrdered, X, Save
} from 'lucide-react';
import SiteControlTab from '@/components/SiteControlTab';
import WeatherSymbolsLibrary from '@/components/WeatherSymbolsLibrary';
import WeatherBackgroundsLibrary from '@/components/WeatherBackgroundsLibrary';
import SubscriptionManagementTab from '@/components/SubscriptionManagementTab';
import { motion, AnimatePresence } from 'framer-motion';
import { format } from 'date-fns';
import { createPageUrl } from '@/utils';

// ─── Priority config ───────────────────────────────────────────────────────────
const priorityConfig = {
  info:    { icon: Info,          color: 'bg-blue-100 text-blue-800',   label: 'Info' },
  warning: { icon: AlertTriangle, color: 'bg-amber-100 text-amber-800', label: 'Warning' },
  urgent:  { icon: Bell,          color: 'bg-red-100 text-red-800',     label: 'Urgent' },
};

// ─── Native drag hook ──────────────────────────────────────────────────────────
function useDragToReorder(items, onReorder) {
  const dragIndex = useRef(null);
  const [dragOverIndex, setDragOverIndex] = useState(null);

  const handleDragStart = (index) => { dragIndex.current = index; };
  const handleDragOver  = (e, index) => { e.preventDefault(); setDragOverIndex(index); };
  const handleDrop = (e, index) => {
    e.preventDefault();
    if (dragIndex.current === null || dragIndex.current === index) { setDragOverIndex(null); return; }
    const next = [...items];
    const [moved] = next.splice(dragIndex.current, 1);
    next.splice(index, 0, moved);
    dragIndex.current = null;
    setDragOverIndex(null);
    onReorder(next);
  };
  const handleDragEnd = () => { dragIndex.current = null; setDragOverIndex(null); };
  return { handleDragStart, handleDragOver, handleDrop, handleDragEnd, dragOverIndex };
}

// ─── Blank form states ─────────────────────────────────────────────────────────
const EMPTY_ANN = { title: '', message: '', priority: 'info', is_active: true };
const EMPTY_UPD = { title: '', description: '', version: '', is_published: true };

// ─── Announcements & Updates tab ───────────────────────────────────────────────
function AnnouncementsAndUpdatesTab() {
  const queryClient = useQueryClient();

  const [annFormOpen,  setAnnFormOpen]  = useState(false);
  const [updFormOpen,  setUpdFormOpen]  = useState(false);
  const [editingAnnId, setEditingAnnId] = useState(null);
  const [editingUpdId, setEditingUpdId] = useState(null);
  const [annForm,  setAnnForm]  = useState(EMPTY_ANN);
  const [updForm,  setUpdForm]  = useState(EMPTY_UPD);

  const [panelOpen, setPanelOpen] = useState(false);
  const [panelOrder, setPanelOrder] = useState([]);
  const [isSaving, setIsSaving]   = useState(false);

  // Tracks whether panelOrder has been initialised from server data yet.
  // Once true, subsequent query refetches won't overwrite the user's dragged order.
  const hasInitialisedOrder = useRef(false);

  // ── Queries ──────────────────────────────────────────────────────────────────
  const { data: announcements = [], isLoading: loadAnn } = useQuery({
    queryKey: ['announcements'],
    queryFn: () => base44.entities.Announcement.list('-created_date'),
  });
  const { data: updates = [], isLoading: loadUpd } = useQuery({
    queryKey: ['appUpdates'],
    queryFn: () => base44.entities.AppUpdate.list('-created_date'),
  });

  // ── Initialise panelOrder from server data — only once ──────────────────────
  // After the first successful load we stop updating panelOrder from queries so
  // that the user's drag order (and saved sort_order) is never wiped by a refetch.
  useEffect(() => {
    // Wait until both queries have returned at least something (even empty arrays).
    if (loadAnn || loadUpd) return;
    // Only run once — after that the user owns panelOrder.
    if (hasInitialisedOrder.current) return;

    const combined = [
      ...announcements.map(a => ({ id: a.id, type: 'announcement', title: a.title, sort_order: a.sort_order ?? 9999 })),
      ...updates.map(u      => ({ id: u.id, type: 'update',       title: u.title, sort_order: u.sort_order ?? 9999 })),
    ].sort((a, b) => a.sort_order - b.sort_order);

    setPanelOrder(combined);
    hasInitialisedOrder.current = true;
  }, [announcements, updates, loadAnn, loadUpd]);

  // When a new item is created, append it to panelOrder without re-sorting everything.
  // We track known IDs so we can detect genuinely new items after mutations.
  const knownIds = useRef(new Set());
  useEffect(() => {
    if (!hasInitialisedOrder.current) return;

    const allFromServer = [
      ...announcements.map(a => ({ id: a.id, type: 'announcement', title: a.title, sort_order: a.sort_order ?? 9999 })),
      ...updates.map(u      => ({ id: u.id, type: 'update',       title: u.title, sort_order: u.sort_order ?? 9999 })),
    ];

    const newItems = allFromServer.filter(item => !knownIds.current.has(item.id));
    if (newItems.length > 0) {
      setPanelOrder(prev => [...prev, ...newItems]);
    }

    // Sync removals — drop anything from panelOrder that no longer exists on the server.
    const serverIds = new Set(allFromServer.map(i => i.id));
    setPanelOrder(prev => prev.filter(item => serverIds.has(item.id)));

    // Update known IDs to the current server set.
    knownIds.current = serverIds;
  }, [announcements, updates]);

  // ── Announcement mutations ────────────────────────────────────────────────────
  const createAnn = useMutation({
    mutationFn: (data) => base44.entities.Announcement.create(data),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['announcements'] }); resetAnnForm(); },
  });
  const updateAnn = useMutation({
    mutationFn: ({ id, data }) => base44.entities.Announcement.update(id, data),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['announcements'] }); resetAnnForm(); },
  });
  const deleteAnn = useMutation({
    mutationFn: (id) => base44.entities.Announcement.delete(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['announcements'] }),
  });

  // ── Update mutations ──────────────────────────────────────────────────────────
  const createUpd = useMutation({
    mutationFn: (data) => base44.entities.AppUpdate.create(data),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['appUpdates'] }); resetUpdForm(); },
  });
  const updateUpd = useMutation({
    mutationFn: ({ id, data }) => base44.entities.AppUpdate.update(id, data),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['appUpdates'] }); resetUpdForm(); },
  });
  const deleteUpd = useMutation({
    mutationFn: (id) => base44.entities.AppUpdate.delete(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['appUpdates'] }),
  });

  // ── Form helpers ──────────────────────────────────────────────────────────────
  const resetAnnForm = () => { setAnnForm(EMPTY_ANN); setEditingAnnId(null); setAnnFormOpen(false); };
  const resetUpdForm = () => { setUpdForm(EMPTY_UPD); setEditingUpdId(null); setUpdFormOpen(false); };

  const openNewAnnForm = () => { setAnnForm(EMPTY_ANN); setEditingAnnId(null); setUpdFormOpen(false); setAnnFormOpen(true); };
  const openNewUpdForm = () => { setUpdForm(EMPTY_UPD); setEditingUpdId(null); setAnnFormOpen(false); setUpdFormOpen(true); };
  const openEditAnn = (a) => {
    setAnnForm({ title: a.title, message: a.message, priority: a.priority || 'info', is_active: a.is_active !== false });
    setEditingAnnId(a.id);
    setUpdFormOpen(false);
    setAnnFormOpen(true);
  };
  const openEditUpd = (u) => {
    setUpdForm({ title: u.title, description: u.description, version: u.version || '', is_published: u.is_published !== false });
    setEditingUpdId(u.id);
    setAnnFormOpen(false);
    setUpdFormOpen(true);
  };

  const handleAnnSubmit = (e) => {
    e.preventDefault();
    if (editingAnnId) updateAnn.mutate({ id: editingAnnId, data: annForm });
    else              createAnn.mutate(annForm);
  };
  const handleUpdSubmit = (e) => {
    e.preventDefault();
    if (editingUpdId) updateUpd.mutate({ id: editingUpdId, data: updForm });
    else              createUpd.mutate(updForm);
  };

  // ── Side panel drag-to-reorder ────────────────────────────────────────────────
  const drag = useDragToReorder(panelOrder, (newOrder) => setPanelOrder(newOrder));

  const saveOrder = async () => {
    setIsSaving(true);
    try {
      await Promise.all(
        panelOrder.map((item, idx) => {
          if (item.type === 'announcement') return base44.entities.Announcement.update(item.id, { sort_order: idx });
          else                              return base44.entities.AppUpdate.update(item.id, { sort_order: idx });
        })
      );
      // Invalidate quietly — hasInitialisedOrder stays true so panelOrder won't be reset.
      queryClient.invalidateQueries({ queryKey: ['announcements'] });
      queryClient.invalidateQueries({ queryKey: ['appUpdates'] });
      setPanelOpen(false);
    } catch (err) {
      console.error('Failed to save order', err);
    } finally {
      setIsSaving(false);
    }
  };

  // ── Sorted display lists ──────────────────────────────────────────────────────
  const sortedAnn = [...announcements].sort((a, b) => (a.sort_order ?? 9999) - (b.sort_order ?? 9999));
  const sortedUpd = [...updates].sort((a, b)       => (a.sort_order ?? 9999) - (b.sort_order ?? 9999));

  const isLoading = loadAnn || loadUpd;

  return (
    <div className="relative">

      {/* ── Top action bar ─────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-xl font-bold text-slate-800">Announcements & Updates</h2>
          <p className="text-slate-500 text-sm">Manage what visitors see in the banner</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => setPanelOpen(true)} className="gap-2">
            <ListOrdered className="w-4 h-4" /> Reorder
          </Button>
          <Button size="sm" onClick={openNewAnnForm} className="bg-purple-600 hover:bg-purple-700 gap-1">
            <Plus className="w-4 h-4" /><Megaphone className="w-3.5 h-3.5" /> Announcement
          </Button>
          <Button size="sm" onClick={openNewUpdForm} className="bg-green-600 hover:bg-green-700 gap-1">
            <Plus className="w-4 h-4" /><Zap className="w-3.5 h-3.5" /> App Update
          </Button>
        </div>
      </div>

      {/* ── Announcement form ──────────────────────────────────────────────────── */}
      <AnimatePresence>
        {annFormOpen && (
          <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}>
            <Card className="mb-6 border-purple-200">
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base flex items-center gap-2">
                    <Megaphone className="w-4 h-4 text-purple-600" />
                    {editingAnnId ? 'Edit Announcement' : 'New Announcement'}
                  </CardTitle>
                  <Button size="icon" variant="ghost" onClick={resetAnnForm}><X className="w-4 h-4" /></Button>
                </div>
              </CardHeader>
              <CardContent>
                <form onSubmit={handleAnnSubmit} className="space-y-4">
                  <div>
                    <Label htmlFor="ann-title">Title</Label>
                    <Input id="ann-title" value={annForm.title} onChange={(e) => setAnnForm(p => ({ ...p, title: e.target.value }))} placeholder="Announcement title" required />
                  </div>
                  <div>
                    <Label htmlFor="ann-message">Message</Label>
                    <Textarea id="ann-message" value={annForm.message} onChange={(e) => setAnnForm(p => ({ ...p, message: e.target.value }))} placeholder="Write your announcement..." rows={3} required />
                  </div>
                  <div className="flex gap-4">
                    <div className="flex-1">
                      <Label>Priority</Label>
                      <Select value={annForm.priority} onValueChange={(v) => setAnnForm(p => ({ ...p, priority: v }))}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="info">Info</SelectItem>
                          <SelectItem value="warning">Warning</SelectItem>
                          <SelectItem value="urgent">Urgent</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="flex items-center gap-2 pt-6">
                      <Switch checked={annForm.is_active} onCheckedChange={(v) => setAnnForm(p => ({ ...p, is_active: v }))} />
                      <Label>Active</Label>
                    </div>
                  </div>
                  <div className="flex gap-2 pt-1">
                    <Button type="button" variant="outline" onClick={resetAnnForm}>Cancel</Button>
                    <Button type="submit" className="bg-purple-600 hover:bg-purple-700" disabled={createAnn.isPending || updateAnn.isPending}>
                      {(createAnn.isPending || updateAnn.isPending) && <Loader2 className="w-4 h-4 animate-spin mr-2" />}
                      {editingAnnId ? 'Update' : 'Create'}
                    </Button>
                  </div>
                </form>
              </CardContent>
            </Card>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── App Update form ────────────────────────────────────────────────────── */}
      <AnimatePresence>
        {updFormOpen && (
          <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}>
            <Card className="mb-6 border-green-200">
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base flex items-center gap-2">
                    <Zap className="w-4 h-4 text-green-600" />
                    {editingUpdId ? 'Edit App Update' : 'New App Update'}
                  </CardTitle>
                  <Button size="icon" variant="ghost" onClick={resetUpdForm}><X className="w-4 h-4" /></Button>
                </div>
              </CardHeader>
              <CardContent>
                <form onSubmit={handleUpdSubmit} className="space-y-4">
                  <div className="flex gap-4">
                    <div className="flex-1">
                      <Label htmlFor="upd-title">Title</Label>
                      <Input id="upd-title" value={updForm.title} onChange={(e) => setUpdForm(p => ({ ...p, title: e.target.value }))} placeholder="e.g. Hourly warnings refresh added" required />
                    </div>
                    <div className="w-32">
                      <Label htmlFor="upd-version">Version / Label</Label>
                      <Input id="upd-version" value={updForm.version} onChange={(e) => setUpdForm(p => ({ ...p, version: e.target.value }))} placeholder="e.g. v1.2" />
                    </div>
                  </div>
                  <div>
                    <Label htmlFor="upd-desc">Description</Label>
                    <Textarea id="upd-desc" value={updForm.description} onChange={(e) => setUpdForm(p => ({ ...p, description: e.target.value }))} placeholder="Describe what changed..." rows={3} required />
                  </div>
                  <div className="flex items-center gap-2">
                    <Switch checked={updForm.is_published} onCheckedChange={(v) => setUpdForm(p => ({ ...p, is_published: v }))} />
                    <Label>Published</Label>
                  </div>
                  <div className="flex gap-2 pt-1">
                    <Button type="button" variant="outline" onClick={resetUpdForm}>Cancel</Button>
                    <Button type="submit" className="bg-green-600 hover:bg-green-700" disabled={createUpd.isPending || updateUpd.isPending}>
                      {(createUpd.isPending || updateUpd.isPending) && <Loader2 className="w-4 h-4 animate-spin mr-2" />}
                      {editingUpdId ? 'Update' : 'Create'}
                    </Button>
                  </div>
                </form>
              </CardContent>
            </Card>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Content lists ──────────────────────────────────────────────────────── */}
      {isLoading ? (
        <div className="py-16 text-center"><Loader2 className="w-8 h-8 animate-spin text-slate-400 mx-auto" /></div>
      ) : (announcements.length === 0 && updates.length === 0) ? (
        <Card>
          <CardContent className="py-16 text-center">
            <Megaphone className="w-12 h-12 text-slate-200 mx-auto mb-3" />
            <p className="text-slate-400">Nothing here yet. Create an announcement or app update above.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-8">
          {sortedAnn.length > 0 && (
            <div>
              <div className="flex items-center gap-2 mb-3">
                <Megaphone className="w-4 h-4 text-purple-500" />
                <span className="text-sm font-semibold text-slate-600 uppercase tracking-wide">Announcements</span>
              </div>
              <div className="space-y-3">
                {sortedAnn.map((a) => {
                  const cfg = priorityConfig[a.priority || 'info'];
                  const Icon = cfg.icon;
                  return (
                    <Card key={a.id} className={!a.is_active ? 'opacity-50' : ''}>
                      <CardContent className="p-4">
                        <div className="flex items-start gap-3">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-1 flex-wrap">
                              <h3 className="font-semibold text-slate-800">{a.title}</h3>
                              <Badge className={cfg.color}><Icon className="w-3 h-3 mr-1" />{cfg.label}</Badge>
                              {!a.is_active && <Badge variant="outline" className="text-slate-400">Inactive</Badge>}
                            </div>
                            <p className="text-slate-600 text-sm">{a.message}</p>
                            <p className="text-xs text-slate-400 mt-1">Created {format(new Date(a.created_date), 'dd/MM/yyyy HH:mm')}</p>
                          </div>
                          <div className="flex gap-1 flex-shrink-0">
                            <Button size="icon" variant="ghost" onClick={() => openEditAnn(a)}><Pencil className="w-4 h-4" /></Button>
                            <Button size="icon" variant="ghost" onClick={() => deleteAnn.mutate(a.id)}><Trash2 className="w-4 h-4 text-red-500" /></Button>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            </div>
          )}

          {sortedUpd.length > 0 && (
            <div>
              <div className="flex items-center gap-2 mb-3">
                <Zap className="w-4 h-4 text-green-500" />
                <span className="text-sm font-semibold text-slate-600 uppercase tracking-wide">App Updates</span>
              </div>
              <div className="space-y-3">
                {sortedUpd.map((u) => (
                  <Card key={u.id} className={!u.is_published ? 'opacity-50' : ''}>
                    <CardContent className="p-4">
                      <div className="flex items-start gap-3">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1 flex-wrap">
                            <h3 className="font-semibold text-slate-800">{u.title}</h3>
                            {u.version && <Badge className="bg-green-100 text-green-800">{u.version}</Badge>}
                            {!u.is_published && <Badge variant="outline" className="text-slate-400">Draft</Badge>}
                          </div>
                          <p className="text-slate-600 text-sm whitespace-pre-line">{u.description}</p>
                          <p className="text-xs text-slate-400 mt-1">Posted {format(new Date(u.created_date), 'dd/MM/yyyy HH:mm')}</p>
                        </div>
                        <div className="flex gap-1 flex-shrink-0">
                          <Button size="icon" variant="ghost" onClick={() => openEditUpd(u)}><Pencil className="w-4 h-4" /></Button>
                          <Button size="icon" variant="ghost" onClick={() => deleteUpd.mutate(u.id)}><Trash2 className="w-4 h-4 text-red-500" /></Button>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Side panel overlay ─────────────────────────────────────────────────── */}
      <AnimatePresence>
        {panelOpen && (
          <>
            <motion.div
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black/30 z-40"
              onClick={() => setPanelOpen(false)}
            />
            <motion.div
              initial={{ x: '100%' }} animate={{ x: 0 }} exit={{ x: '100%' }}
              transition={{ type: 'spring', damping: 28, stiffness: 280 }}
              className="fixed top-0 right-0 h-full w-80 bg-white shadow-2xl z-50 flex flex-col"
            >
              <div className="flex items-center justify-between px-5 py-4 border-b">
                <div>
                  <h3 className="font-bold text-slate-800">Display Order</h3>
                  <p className="text-xs text-slate-400 mt-0.5">Drag to set the order visitors see</p>
                </div>
                <Button size="icon" variant="ghost" onClick={() => setPanelOpen(false)}><X className="w-4 h-4" /></Button>
              </div>

              <div className="flex-1 overflow-y-auto px-4 py-4 space-y-2">
                {panelOrder.length === 0 ? (
                  <p className="text-center text-slate-400 text-sm pt-8">No items yet.</p>
                ) : panelOrder.map((item, index) => (
                  <div
                    key={item.id}
                    draggable
                    onDragStart={() => drag.handleDragStart(index)}
                    onDragOver={(e) => drag.handleDragOver(e, index)}
                    onDrop={(e) => drag.handleDrop(e, index)}
                    onDragEnd={drag.handleDragEnd}
                    className={`flex items-center gap-3 p-3 rounded-xl border bg-white select-none transition-all duration-100 cursor-grab active:cursor-grabbing
                      ${drag.dragOverIndex === index ? 'border-blue-400 scale-[1.02] shadow-md opacity-70' : 'border-slate-200 hover:border-slate-300 hover:shadow-sm'}`}
                  >
                    <GripVertical className="w-4 h-4 text-slate-300 flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-slate-700 truncate">{item.title}</p>
                      <span className={`text-xs font-semibold px-1.5 py-0.5 rounded-full mt-0.5 inline-block
                        ${item.type === 'announcement' ? 'bg-purple-100 text-purple-700' : 'bg-green-100 text-green-700'}`}>
                        {item.type === 'announcement' ? '📢 Announcement' : '⚡ App Update'}
                      </span>
                    </div>
                    <span className="text-xs text-slate-300 font-mono flex-shrink-0">#{index + 1}</span>
                  </div>
                ))}
              </div>

              <div className="px-5 py-4 border-t bg-slate-50">
                <Button onClick={saveOrder} disabled={isSaving} className="w-full bg-slate-800 hover:bg-slate-700 gap-2">
                  {isSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                  {isSaving ? 'Saving…' : 'Save Order'}
                </Button>
                <p className="text-xs text-slate-400 text-center mt-2">Order affects how items appear in the banner</p>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}

// ─── Main Dashboard ────────────────────────────────────────────────────────────
export default function Dashboard() {
  const [isAdmin, setIsAdmin] = useState(null);

  useEffect(() => {
    base44.auth.me()
      .then(user => setIsAdmin(user?.role === 'admin'))
      .catch(() => setIsAdmin(false));
  }, []);

  if (isAdmin === null) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-slate-400" />
      </div>
    );
  }

  if (isAdmin === false) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <Card className="max-w-md">
          <CardContent className="pt-6 text-center">
            <AlertTriangle className="w-12 h-12 text-amber-500 mx-auto mb-4" />
            <h2 className="text-xl font-bold mb-2">Access Denied</h2>
            <p className="text-slate-500">You don't have permission to view this page.</p>
            <Button className="mt-4" onClick={() => window.location.href = createPageUrl('Home')}>Go Home</Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 p-6">
      <div className="max-w-4xl mx-auto">
        <div className="flex items-center gap-3 mb-8">
          <div className="p-3 rounded-xl bg-purple-100">
            <Megaphone className="w-6 h-6 text-purple-600" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-slate-800">Dashboard</h1>
            <p className="text-slate-500 text-sm">Manage announcements and app updates</p>
          </div>
        </div>

        <Tabs defaultValue="content">
          <TabsList className="mb-6">
            <TabsTrigger value="content"       className="gap-2"><Megaphone className="w-4 h-4" /> Announcements & Updates</TabsTrigger>
            <TabsTrigger value="sitecontrol"   className="gap-2"><Settings  className="w-4 h-4" /> Site Control</TabsTrigger>
            <TabsTrigger value="symbols"       className="gap-2"><CloudSun  className="w-4 h-4" /> Weather Symbols</TabsTrigger>
            <TabsTrigger value="backgrounds"   className="gap-2"><Layers    className="w-4 h-4" /> Backgrounds</TabsTrigger>
            <TabsTrigger value="subscriptions" className="gap-2"><Crown     className="w-4 h-4" /> Subscriptions</TabsTrigger>
          </TabsList>

          <TabsContent value="content"><AnnouncementsAndUpdatesTab /></TabsContent>
          <TabsContent value="sitecontrol"><SiteControlTab /></TabsContent>
          <TabsContent value="symbols"><WeatherSymbolsLibrary /></TabsContent>
          <TabsContent value="backgrounds"><WeatherBackgroundsLibrary /></TabsContent>
          <TabsContent value="subscriptions"><SubscriptionManagementTab /></TabsContent>
        </Tabs>
      </div>
    </div>
  );
}