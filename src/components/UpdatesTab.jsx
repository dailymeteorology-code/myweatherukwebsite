import React, { useState, useEffect, useRef } from 'react';
import { base44 } from '@/api/base44Client';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Plus, Pencil, Trash2, Loader2, Zap, GripVertical } from 'lucide-react';
import { motion } from 'framer-motion';
import { format } from 'date-fns';

const emptyForm = { title: '', description: '', version: '', is_published: true };

// ─── Native drag-and-drop hook (no external deps) ─────────────────────────────
function useDragToReorder(items, onReorder) {
  const dragIndex = useRef(null);
  const [dragOverIndex, setDragOverIndex] = useState(null);

  const handleDragStart = (index) => { dragIndex.current = index; };

  const handleDragOver = (e, index) => {
    e.preventDefault();
    setDragOverIndex(index);
  };

  const handleDrop = (e, index) => {
    e.preventDefault();
    if (dragIndex.current === null || dragIndex.current === index) {
      setDragOverIndex(null);
      return;
    }
    const newItems = [...items];
    const [moved] = newItems.splice(dragIndex.current, 1);
    newItems.splice(index, 0, moved);
    dragIndex.current = null;
    setDragOverIndex(null);
    onReorder(newItems);
  };

  const handleDragEnd = () => {
    dragIndex.current = null;
    setDragOverIndex(null);
  };

  return { handleDragStart, handleDragOver, handleDrop, handleDragEnd, dragOverIndex };
}

// ─── Draggable Update Card ────────────────────────────────────────────────────
function DraggableUpdateCard({ update, index, onEdit, onDelete, dragHandlers, isDragOver }) {
  return (
    <div
      draggable
      onDragStart={() => dragHandlers.handleDragStart(index)}
      onDragOver={(e) => dragHandlers.handleDragOver(e, index)}
      onDrop={(e) => dragHandlers.handleDrop(e, index)}
      onDragEnd={dragHandlers.handleDragEnd}
      className={`transition-all duration-150 ${isDragOver ? 'scale-[1.02] opacity-60' : ''}`}
    >
      <Card className={!update.is_published ? 'opacity-50' : ''}>
        <CardContent className="p-4">
          <div className="flex items-start gap-3">
            <div
              className="mt-1 cursor-grab active:cursor-grabbing text-slate-300 hover:text-slate-500 transition-colors flex-shrink-0 select-none"
              title="Drag to reorder"
            >
              <GripVertical className="w-5 h-5" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1 flex-wrap">
                <h3 className="font-semibold text-slate-800">{update.title}</h3>
                {update.version && <Badge className="bg-green-100 text-green-800">{update.version}</Badge>}
                {!update.is_published && <Badge variant="outline" className="text-slate-400">Draft</Badge>}
              </div>
              <p className="text-slate-600 text-sm whitespace-pre-line">{update.description}</p>
              <p className="text-xs text-slate-400 mt-2">
                Posted {format(new Date(update.created_date), 'dd/MM/yyyy HH:mm')}
              </p>
            </div>
            <div className="flex gap-2 flex-shrink-0">
              <Button size="icon" variant="ghost" onClick={() => onEdit(update)}>
                <Pencil className="w-4 h-4" />
              </Button>
              <Button size="icon" variant="ghost" onClick={() => onDelete(update.id)}>
                <Trash2 className="w-4 h-4 text-red-500" />
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// ─── Main UpdatesTab ──────────────────────────────────────────────────────────
export default function UpdatesTab() {
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [formData, setFormData] = useState(emptyForm);
  const [orderedUpdates, setOrderedUpdates] = useState([]);
  const [isSavingOrder, setIsSavingOrder] = useState(false);
  const queryClient = useQueryClient();

  const { data: updates = [], isLoading } = useQuery({
    queryKey: ['appUpdates'],
    queryFn: () => base44.entities.AppUpdate.list('-created_date'),
  });

  useEffect(() => {
    if (updates.length > 0) {
      const sorted = [...updates].sort((a, b) => (a.sort_order ?? 9999) - (b.sort_order ?? 9999));
      setOrderedUpdates(sorted);
    } else {
      setOrderedUpdates([]);
    }
  }, [updates]);

  const createMutation = useMutation({
    mutationFn: (data) => base44.entities.AppUpdate.create(data),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['appUpdates'] }); resetForm(); },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }) => base44.entities.AppUpdate.update(id, data),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['appUpdates'] }); resetForm(); },
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => base44.entities.AppUpdate.delete(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['appUpdates'] }),
  });

  const resetForm = () => { setFormData(emptyForm); setEditingId(null); setShowForm(false); };

  const handleEdit = (update) => {
    setFormData({ title: update.title, description: update.description, version: update.version || '', is_published: update.is_published !== false });
    setEditingId(update.id);
    setShowForm(true);
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    if (editingId) {
      updateMutation.mutate({ id: editingId, data: formData });
    } else {
      createMutation.mutate(formData);
    }
  };

  const handleReorder = async (newOrder) => {
    const prev = orderedUpdates;
    setOrderedUpdates(newOrder);
    setIsSavingOrder(true);
    try {
      await Promise.all(
        newOrder.map((item, idx) =>
          base44.entities.AppUpdate.update(item.id, { sort_order: idx })
        )
      );
      queryClient.invalidateQueries({ queryKey: ['appUpdates'] });
    } catch (err) {
      console.error('Failed to save update order:', err);
      setOrderedUpdates(prev);
    } finally {
      setIsSavingOrder(false);
    }
  };

  const dragHandlers = useDragToReorder(orderedUpdates, handleReorder);

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="p-3 rounded-xl bg-green-100">
            <Zap className="w-5 h-5 text-green-600" />
          </div>
          <div>
            <h2 className="text-xl font-bold text-slate-800">App Updates</h2>
            <p className="text-slate-500 text-sm">Announce new features and changes · drag ⠿ to reorder</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {isSavingOrder && (
            <span className="text-xs text-slate-400 flex items-center gap-1">
              <Loader2 className="w-3 h-3 animate-spin" /> Saving order…
            </span>
          )}
          <Button onClick={() => setShowForm(!showForm)} className="bg-green-600 hover:bg-green-700">
            <Plus className="w-4 h-4 mr-2" /> New Update
          </Button>
        </div>
      </div>

      {showForm && (
        <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }}>
          <Card className="mb-6">
            <CardHeader>
              <CardTitle>{editingId ? 'Edit Update' : 'New Update'}</CardTitle>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="flex gap-4">
                  <div className="flex-1">
                    <Label htmlFor="update-title">Title</Label>
                    <Input id="update-title" value={formData.title} onChange={(e) => setFormData(prev => ({ ...prev, title: e.target.value }))} placeholder="e.g. Hourly warnings refresh added" required />
                  </div>
                  <div className="w-32">
                    <Label htmlFor="version">Version / Label</Label>
                    <Input id="version" value={formData.version} onChange={(e) => setFormData(prev => ({ ...prev, version: e.target.value }))} placeholder="e.g. v1.2" />
                  </div>
                </div>
                <div>
                  <Label htmlFor="update-desc">Description</Label>
                  <Textarea id="update-desc" value={formData.description} onChange={(e) => setFormData(prev => ({ ...prev, description: e.target.value }))} placeholder="Describe what changed..." rows={4} required />
                </div>
                <div className="flex items-center gap-2">
                  <Switch checked={formData.is_published} onCheckedChange={(v) => setFormData(prev => ({ ...prev, is_published: v }))} />
                  <Label>Published</Label>
                </div>
                <div className="flex gap-2 pt-2">
                  <Button type="button" variant="outline" onClick={resetForm}>Cancel</Button>
                  <Button type="submit" className="bg-green-600 hover:bg-green-700" disabled={createMutation.isPending || updateMutation.isPending}>
                    {(createMutation.isPending || updateMutation.isPending) && <Loader2 className="w-4 h-4 animate-spin mr-2" />}
                    {editingId ? 'Update' : 'Create'}
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>
        </motion.div>
      )}

      {isLoading ? (
        <div className="text-center py-12"><Loader2 className="w-8 h-8 animate-spin text-slate-400 mx-auto" /></div>
      ) : orderedUpdates.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <Zap className="w-12 h-12 text-slate-300 mx-auto mb-4" />
            <p className="text-slate-500">No updates yet. Create one to get started.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {orderedUpdates.map((update, index) => (
            <DraggableUpdateCard
              key={update.id}
              update={update}
              index={index}
              onEdit={handleEdit}
              onDelete={(id) => deleteMutation.mutate(id)}
              dragHandlers={dragHandlers}
              isDragOver={dragHandlers.dragOverIndex === index}
            />
          ))}
        </div>
      )}
    </div>
  );
}