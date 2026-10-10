import React from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { ChevronLeft, Newspaper, Home } from 'lucide-react';
import { useLogo } from '@/components/MobileHeaderLogo';

const ROOT_PATHS = new Set(['/', '/Home', '/Graphics', '/Lightning', '/TCMOutlooks', '/WeatherPatterns', '/Settings', '/AdminSettings', '/News']);

export default function MobileHeader({ siteSettings }) {
  const location = useLocation();
  const navigate = useNavigate();
  const isRoot = ROOT_PATHS.has(location.pathname);
  const isNews = location.pathname === '/News';
  const isHome = location.pathname === '/' || location.pathname === '/Home';
  const fallbackLogo = useLogo();
  const logoUrl = siteSettings?.logo_url || fallbackLogo;

  const handleBack = () => {
    if (window.history.length > 1) navigate(-1);else
    navigate('/');
  };

  return (
    <header
      className="md:hidden sticky top-0 z-40 flex items-center justify-between px-3.5 backdrop-blur-xl bg-white/85 dark:bg-slate-900/85 border-b border-slate-200/70 dark:border-slate-700/60 shadow-[0_1px_14px_rgba(15,23,42,0.06)] dark:shadow-[0_1px_14px_rgba(0,0,0,0.35)]"
      style={{
        paddingTop: 'env(safe-area-inset-top)',
        height: 'calc(48px + env(safe-area-inset-top))'
      }}>
      
      {/* Left: logo or back */}
      {isRoot ?
      <Link to="/" className="flex items-center gap-2 min-w-0">
          {logoUrl &&
        <img src={logoUrl} alt="MyWeather" className="h-7 w-7 rounded-full object-cover flex-shrink-0 ring-1 ring-slate-200 dark:ring-slate-700 shadow-sm" />
        }
          <span className="text-sm font-bold tracking-tight text-slate-800 dark:text-slate-100 truncate">
            {siteSettings?.site_name || 'MyWeather'}
          </span>
        </Link> :

      <button
        onClick={handleBack}
        className="flex items-center gap-1 -ml-1 px-2 py-1.5 rounded-lg text-slate-700 dark:text-slate-200 active:bg-slate-200 dark:active:bg-slate-700">
        
          <ChevronLeft className="w-5 h-5" />
          <span className="text-sm font-medium">Back</span>
        </button>
      }

      {/* Right: contextual nav pill */}
      {isHome &&
      <Link
        to="/News"
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-700 active:scale-95 transition-transform hidden">



        
          <Newspaper className="w-3.5 h-3.5" />
          News
        </Link>
      }
      {isNews &&
      <Link
        to="/"
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold
            bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300
            border border-slate-200 dark:border-slate-700
            active:scale-95 transition-transform">



        
          <Home className="w-3.5 h-3.5" />
          Home
        </Link>
      }
      {!isHome && !isNews && <div className="w-8" />}
    </header>);

}