/* sonner's toaster. The admin screens and graphic studios call sonner's toast.success() and
   toast.error(), and nothing showed them: only the other (shadcn) toaster was mounted. Themed with
   the site's own light/dark setting. */
import React from 'react';
import { Toaster as Sonner } from 'sonner';
import { useTheme } from '@/components/ThemeContext';

export function Toaster(props) {
  const { isDark } = useTheme();
  return <Sonner theme={isDark ? 'dark' : 'light'} position="top-center" richColors closeButton {...props} />;
}
