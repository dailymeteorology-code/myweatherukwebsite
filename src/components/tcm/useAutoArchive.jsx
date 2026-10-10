import { useEffect } from 'react';
import { useMutation } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';

export default function useAutoArchive(outlooks, queryClient) {
  const mutation = useMutation({
    mutationFn: async (updates) => { await Promise.all(updates.map(({ id, patch }) => base44.entities.TCMOutlook.update(id, patch))); },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['tcmOutlooks'] }),
  });
  useEffect(() => {
    if (!outlooks || outlooks.length === 0) return;
    const runArchive = () => {
      const now = new Date();
      const todayStr = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;
      const updates = [];
      outlooks.forEach(o => {
        if (!o.is_archived && o.outlook_date && o.outlook_date < todayStr && !o.is_upcoming && !o.is_tomorrow)
          updates.push({ id: o.id, patch: { is_today: false, is_archived: true } });
        if (o.is_tomorrow && o.outlook_date && o.outlook_date <= todayStr)
          updates.push({ id: o.id, patch: { is_tomorrow: false, is_today: true } });
        if (o.is_two_day && o.outlook_date) {
          const d = new Date(o.outlook_date + 'T12:00:00');
          if (Math.round((d - now) / 86400000) <= 1) updates.push({ id: o.id, patch: { is_two_day: false, is_tomorrow: true } });
        }
        if (o.is_upcoming && o.outlook_date) {
          const d = new Date(o.outlook_date + 'T12:00:00');
          if (Math.round((d - now) / 86400000) <= 2) updates.push({ id: o.id, patch: { is_upcoming: false, is_two_day: true } });
        }
      });
      if (updates.length) mutation.mutate(updates);
    };
    runArchive();
    const now = new Date();
    const ms = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 5).getTime() - now.getTime();
    const t = setTimeout(runArchive, ms);
    return () => clearTimeout(t);
  }, [outlooks]); // eslint-disable-line
}