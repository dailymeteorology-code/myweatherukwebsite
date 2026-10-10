import React from 'react';
import StormStudioGraphicTool from '@/components/tcm/StormStudioGraphicTool';
import { Zap } from 'lucide-react';

export default function ThunderstormStudio() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-sky-50">
      <div className="max-w-6xl mx-auto px-4 py-8">
        {/* Header */}
        <div className="flex items-center gap-3 mb-6">
          <div className="w-11 h-11 rounded-xl bg-indigo-900/50 border border-indigo-700 flex items-center justify-center flex-shrink-0">
            <Zap className="w-5 h-5 text-yellow-400" />
          </div>
          <div>
            <h1 className="text-3xl font-bold text-slate-800">Thunderstorm Graphic Studio</h1>
            <p className="text-slate-500 mt-1">Build your own thunderstorm outlook graphic. Log in to save your work to your account.</p>
          </div>
        </div>

        {/* Studio tool — a distinct, lean studio-only graphic builder */}
        <div className="p-4 rounded-2xl bg-slate-950 border border-slate-800">
          <StormStudioGraphicTool />
        </div>
      </div>
    </div>
  );
}