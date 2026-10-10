import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { base44 } from '@/api/base44Client';
import TCMSection from '@/components/TCMSection';

export default function TCMOutlooksHero() {
  const { data: outlooks = [], isLoading } = useQuery({
    queryKey: ['tcmOutlooks'],
    queryFn: async () => {
      try {
        return (await base44.entities.TCMOutlook.filter({ is_published: true }, '-outlook_date', 50)) || [];
      } catch {
        return [];
      }
    },
    refetchInterval: 60_000,
  });

  return (
    <section style={{ position: 'relative', zIndex: 1, padding: '24px 16px 12px' }}>
      {isLoading ? (
        <div style={{ textAlign: 'center', padding: '32px 0', color: '#64748b', fontSize: '0.85rem' }}>
          Loading outlooks…
        </div>
      ) : (
        <TCMSection outlooks={outlooks} isOwner={false} />
      )}
    </section>
  );
}