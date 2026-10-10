import React, { useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import { usePullToRefresh } from '@/hooks/usePullToRefresh';
import { Plus, Image, Loader2, Search, Archive, ChevronRight, Zap, Sun } from 'lucide-react';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import GraphicCard from '@/components/GraphicCard';
import GraphicForm from '@/components/GraphicForm';
import MyWeatherLightningVerification from '@/components/MyWeatherLightningVerification';
import StormOutlookGraphicTool from '@/components/StormOutlookGraphicTool';
import SolarEclipseGraphicTool from '@/components/SolarEclipseGraphicTool';

export default function Graphics() {
  const [showForm, setShowForm] = useState(false);
  const [editingGraphic, setEditingGraphic] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [showGraphicTool, setShowGraphicTool] = useState(false);
  const [showEclipseTool, setShowEclipseTool] = useState(false);
  const queryClient = useQueryClient();

  // Pull-to-refresh: invalidate the graphics list so it reloads from the server
  const handlePullRefresh = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: ['graphics'] });
  }, [queryClient]);
  const { isPulling, isRefreshing, pullProgress, onTouchStart, onTouchMove, onTouchEnd } =
    usePullToRefresh(handlePullRefresh);

  const { data: graphics, isLoading } = useQuery({
    queryKey: ['graphics'],
    queryFn: () => base44.entities.WeatherGraphic.list('-created_date'),
    initialData: [],
  });

  const createMutation = useMutation({
    mutationFn: (data) => base44.entities.WeatherGraphic.create(data),
    // Optimistically insert the new graphic at the top so the UI feels instant
    onMutate: async (data) => {
      await queryClient.cancelQueries({ queryKey: ['graphics'] });
      const previous = queryClient.getQueryData(['graphics']) || [];
      const optimistic = {
        ...data,
        id: `optimistic-${Date.now()}`,
        created_date: new Date().toISOString(),
        _optimistic: true,
      };
      queryClient.setQueryData(['graphics'], [optimistic, ...previous]);
      setShowForm(false);
      return { previous };
    },
    onError: (_e, _d, ctx) => { if (ctx?.previous) queryClient.setQueryData(['graphics'], ctx.previous); },
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['graphics'] }),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }) => base44.entities.WeatherGraphic.update(id, data),
    // Optimistically patch the matching graphic in the cached list
    onMutate: async ({ id, data }) => {
      await queryClient.cancelQueries({ queryKey: ['graphics'] });
      const previous = queryClient.getQueryData(['graphics']) || [];
      queryClient.setQueryData(['graphics'], previous.map(g => g.id === id ? { ...g, ...data, _optimistic: true } : g));
      setShowForm(false);
      setEditingGraphic(null);
      return { previous };
    },
    onError: (_e, _d, ctx) => { if (ctx?.previous) queryClient.setQueryData(['graphics'], ctx.previous); },
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['graphics'] }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => base44.entities.WeatherGraphic.delete(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['graphics'] }),
  });

  const handleSubmit = async (data) => {
    // If this is a continuation, archive the parent graphic first
    if (data.is_continuation && data.parent_graphic_id) {
      try {
        await base44.entities.WeatherGraphic.update(data.parent_graphic_id, {
          is_archived: true,
        });
      } catch (e) {
        console.warn('[Graphics] Could not archive parent graphic:', e?.message);
      }
    }
    // Strip internal-only fields before saving
    const { is_continuation, parent_graphic_id, ...saveData } = data;
    if (editingGraphic) {
      updateMutation.mutate({ id: editingGraphic.id, data: saveData });
    } else {
      createMutation.mutate(saveData);
    }
  };

  const handleEdit = (graphic) => {
    setEditingGraphic(graphic);
    setShowForm(true);
  };

  const handleToggleFeatured = (graphic) => {
    updateMutation.mutate({
      id: graphic.id,
      data: { is_featured: !graphic.is_featured }
    });
  };

  const filteredGraphics = graphics.filter(g => 
    g.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
    g.description?.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div
      className="min-h-screen bg-gradient-to-br from-slate-50 to-sky-50"
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
    >
      {/* Pull-to-refresh indicator */}
      <AnimatePresence>
        {(isPulling || isRefreshing) && (
          <motion.div
            key="ptr-graphics"
            initial={{ y: -48, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: -48, opacity: 0 }}
            transition={{ type: 'spring', damping: 22, stiffness: 280 }}
            style={{
              position: 'fixed',
              top: 'calc(12px + env(safe-area-inset-top, 0px))',
              left: '50%', transform: 'translateX(-50%)',
              zIndex: 9000, pointerEvents: 'none',
              display: 'flex', alignItems: 'center', gap: 8,
              padding: '7px 14px', borderRadius: 99,
              background: 'rgba(255,255,255,0.95)',
              border: '1px solid rgba(14,165,233,0.20)',
              backdropFilter: 'blur(14px)',
              boxShadow: '0 4px 20px rgba(0,0,0,0.10)',
            }}
          >
            <svg width="16" height="16" viewBox="0 0 16 16" style={{ flexShrink: 0 }}>
              <circle cx="8" cy="8" r="6" fill="none" stroke="rgba(14,165,233,0.18)" strokeWidth="2" />
              <motion.circle cx="8" cy="8" r="6" fill="none"
                stroke="#0ea5e9" strokeWidth="2" strokeLinecap="round"
                strokeDasharray="37.7"
                animate={{
                  strokeDashoffset: isRefreshing ? [37.7, 0] : 37.7 * (1 - pullProgress),
                  rotate: isRefreshing ? 360 : pullProgress * 300,
                }}
                transition={isRefreshing
                  ? { duration: 0.9, repeat: Infinity, ease: 'linear' }
                  : { duration: 0 }
                }
                style={{ transformOrigin: '8px 8px', transform: 'rotate(-90deg)' }}
              />
            </svg>
            <span style={{
              fontSize: 11, fontWeight: 700, letterSpacing: '0.04em',
              color: '#334155',
              fontFamily: 'DM Sans, system-ui, sans-serif',
            }}>
              {isRefreshing ? 'Refreshing…' : pullProgress >= 1 ? 'Release to refresh' : 'Pull to refresh'}
            </span>
          </motion.div>
        )}
      </AnimatePresence>
      <div className="max-w-6xl mx-auto px-4 py-8">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-8">
          <div>
            <h1 className="text-3xl font-bold text-slate-800">Weather Graphics</h1>
            <p className="text-slate-500 mt-1">Manage your weather graphics and forecasts</p>
          </div>
          <Button 
            onClick={() => {
              setEditingGraphic(null);
              setShowForm(true);
            }}
            className="bg-sky-600 hover:bg-sky-700"
          >
            <Plus className="w-5 h-5 mr-2" />
            Add Graphic
          </Button>
        </div>

        {/* Graphic Studio launcher */}
        <div className="mb-6">
          <button
            type="button"
            onClick={() => setShowGraphicTool(v => !v)}
            className="w-full group flex items-center gap-3 p-4 rounded-2xl bg-slate-900 border border-slate-700 hover:border-indigo-500 hover:shadow-md transition-all text-left"
          >
            <div className="w-11 h-11 rounded-xl bg-indigo-900/50 border border-indigo-700 flex items-center justify-center flex-shrink-0 group-hover:bg-indigo-800/60 transition-colors">
              <Zap className="w-5 h-5 text-yellow-400" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-bold text-slate-100">Storm Outlook Graphic Tool</p>
              <p className="text-xs text-slate-400">Create, save and reload thunderstorm outlook graphics</p>
            </div>
            <ChevronRight className={`w-4 h-4 text-slate-500 group-hover:text-indigo-400 transition-all ${showGraphicTool ? 'rotate-90' : ''}`} />
          </button>
          {showGraphicTool && (
            <div className="mt-3 p-4 rounded-2xl bg-slate-950 border border-slate-800">
              <StormOutlookGraphicTool />
            </div>
          )}
        </div>

        {/* Solar eclipse card */}
        <div className="mb-6">
          <button
            type="button"
            onClick={() => setShowEclipseTool(v => !v)}
            className="w-full group flex items-center gap-3 p-4 rounded-2xl bg-slate-900 border border-slate-700 hover:border-amber-500 hover:shadow-md transition-all text-left"
          >
            <div className="w-11 h-11 rounded-xl bg-amber-900/40 border border-amber-700 flex items-center justify-center flex-shrink-0 group-hover:bg-amber-800/50 transition-colors">
              <Sun className="w-5 h-5 text-amber-300" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-bold text-slate-100">Solar Eclipse Graphic Tool</p>
              <p className="text-xs text-slate-400">Coverage map with per-location obscuration, times and weather symbols</p>
            </div>
            <ChevronRight className={`w-4 h-4 text-slate-500 group-hover:text-amber-400 transition-all ${showEclipseTool ? 'rotate-90' : ''}`} />
          </button>
          {showEclipseTool && (
            <div className="mt-3 p-4 rounded-2xl bg-slate-950 border border-slate-800">
              <SolarEclipseGraphicTool />
            </div>
          )}
        </div>

        {/* Quick link to Archive */}
        <div className="mb-6">
          <Link to="/MyWeatherArchive"
            className="group flex items-center gap-3 p-4 rounded-2xl bg-white border border-slate-200 hover:border-sky-400 hover:shadow-md transition-all"
          >
            <div className="w-11 h-11 rounded-xl bg-sky-50 border border-sky-200 flex items-center justify-center flex-shrink-0 group-hover:bg-sky-100 transition-colors">
              <Archive className="w-5 h-5 text-sky-600" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-bold text-slate-800">MyWeather Archive</p>
              <p className="text-xs text-slate-500">Browse all archived graphics</p>
            </div>
            <ChevronRight className="w-4 h-4 text-slate-400 group-hover:text-sky-600 transition-colors" />
          </Link>
        </div>

        {/* Live Lightning Verification map */}
        <div className="mb-6">
          <MyWeatherLightningVerification />
        </div>

        {/* Search */}
        <div className="relative mb-8">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
          <Input
            placeholder="Search graphics..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-12 h-12 bg-white border-slate-200"
          />
        </div>

        {/* Grid */}
        {isLoading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="w-8 h-8 animate-spin text-sky-600" />
          </div>
        ) : filteredGraphics.length > 0 ? (
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
            <AnimatePresence mode="popLayout">
              {filteredGraphics.map((graphic, index) => (
                <GraphicCard
                  key={graphic.id}
                  graphic={graphic}
                  index={index}
                  onEdit={handleEdit}
                  onDelete={(id) => deleteMutation.mutate(id)}
                  onToggleFeatured={handleToggleFeatured}
                />
              ))}
            </AnimatePresence>
          </div>
        ) : (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="text-center py-20"
          >
            <div className="w-20 h-20 rounded-full bg-slate-100 flex items-center justify-center mx-auto mb-4">
              <Image className="w-10 h-10 text-slate-400" />
            </div>
            <h3 className="text-xl font-semibold text-slate-700 mb-2">
              {searchQuery ? 'No matching graphics' : 'No graphics yet'}
            </h3>
            <p className="text-slate-500 mb-6">
              {searchQuery ? 'Try a different search term' : 'Add your first weather graphic to get started'}
            </p>
            {!searchQuery && (
              <Button 
                onClick={() => setShowForm(true)}
                className="bg-sky-600 hover:bg-sky-700"
              >
                <Plus className="w-5 h-5 mr-2" />
                Add Your First Graphic
              </Button>
            )}
          </motion.div>
        )}
      </div>

      {/* Form Dialog */}
      <Dialog open={showForm} onOpenChange={setShowForm}>
        <DialogContent className="max-w-[95vw] w-full h-[95vh] flex flex-col p-0 overflow-hidden">
          <DialogHeader className="px-6 pt-6 pb-4 border-b flex-shrink-0">
            <DialogTitle>
              {editingGraphic ? 'Edit Graphic' : 'Add New Graphic'}
            </DialogTitle>
          </DialogHeader>
          <div className="flex-1 overflow-y-auto overflow-x-auto p-6">
            <GraphicForm
              graphic={editingGraphic}
              existingGraphics={graphics}
              onSubmit={handleSubmit}
              onCancel={() => {
                setShowForm(false);
                setEditingGraphic(null);
              }}
              isLoading={createMutation.isPending || updateMutation.isPending}
            />
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}