import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Search, AlertCircle, X, MapPin } from 'lucide-react';
import { useNavigate, useLocation } from 'react-router-dom';
import { createPageUrl } from '@/utils';
import { base44 } from '@/api/base44Client';
import { useTheme } from '@/components/ThemeContext';

export default function LocationSearch({ expandOnHover = false }) {
  const [searchQuery, setSearchQuery] = useState('');
  const [hovering, setHovering] = useState(false);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState('');
  const [isAdmin, setIsAdmin] = useState(false);
  const [suggestions, setSuggestions] = useState([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const suggestionsRef = useRef(null);
  const debounceRef = useRef(null);
  const navigate = useNavigate();
  const location = useLocation();
  const { isDark } = useTheme();

  useEffect(() => {
    base44.auth.me().then(user => {
      setIsAdmin(user?.role === 'admin');
    }).catch(() => {
      setIsAdmin(false);
    });
  }, []);

  const fetchSuggestions = async (query) => {
    if (query.trim().length < 2) {
      setSuggestions([]);
      setShowSuggestions(false);
      return;
    }

    try {
      const response = await fetch(
        `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&countrycodes=gb&format=json&limit=5`
      );
      const data = await response.json();
      const locations = data.map(item => {
        const parts = item.display_name.split(',').map(p => p.trim());
        const city = parts[0];
        // Find country (last non-empty part)
        const country = parts[parts.length - 1] || '';
        // Find county/state (second to last, if different from country)
        const region = parts.length > 2 ? parts[parts.length - 2] : '';
        const subtitle = region && region !== country ? `${region}, ${country}` : country;
        return {
          name: item.name,
          displayName: city,
          subtitle,
          lat: item.lat,
          lon: item.lon
        };
      });
      setSuggestions(locations);
      setShowSuggestions(true);
    } catch (err) {
      console.error('Error fetching suggestions:', err);
      setSuggestions([]);
    }
  };

  const handleInputChange = (e) => {
    const value = e.target.value;
    setSearchQuery(value);

    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }

    debounceRef.current = setTimeout(() => {
      fetchSuggestions(value);
    }, 300);
  };

  const handleSuggestionClick = async (suggestion) => {
    setSearchQuery(suggestion.displayName);
    setShowSuggestions(false);
    setSuggestions([]);

    const { allowed } = canSearch();

    if (!allowed) {
      setError('You have reached your search limit of 2 searches per day. Please try again tomorrow.');
      setTimeout(() => setError(''), 5000);
      return;
    }

    setSearching(true);
    recordSearch();
    localStorage.setItem('hasSearchedWeather', 'true');

    setTimeout(() => {
      navigate(createPageUrl(`LocationWeather?location=${encodeURIComponent(suggestion.displayName)}`));
      setSearchQuery('');
      setSearching(false);
    }, 300);
  };

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (suggestionsRef.current && !suggestionsRef.current.contains(e.target)) {
        setShowSuggestions(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const canSearch = () => {
    if (isAdmin) return { allowed: true, count: 0 };

    const today = new Date().toDateString();
    const searchData = localStorage.getItem('locationSearches');
    
    if (!searchData) {
      return { allowed: true, count: 0 };
    }

    const data = JSON.parse(searchData);
    if (data.date !== today) {
      return { allowed: true, count: 0 };
    }

    return { allowed: data.count < 2, count: data.count };
  };

  const recordSearch = () => {
    const today = new Date().toDateString();
    const data = { date: today, count: 1 };
    const existing = localStorage.getItem('locationSearches');
    
    if (existing) {
      const parsed = JSON.parse(existing);
      if (parsed.date === today) {
        data.count = parsed.count + 1;
      }
    }
    
    localStorage.setItem('locationSearches', JSON.stringify(data));
  };

  const handleSearch = async (e) => {
    e.preventDefault();
    if (!searchQuery.trim()) return;

    const { allowed, count } = canSearch();

    if (!allowed) {
      setError('You have reached your search limit of 2 searches per day. Please try again tomorrow.');
      setTimeout(() => setError(''), 5000);
      return;
    }

    setSearching(true);
    recordSearch();
    localStorage.setItem('hasSearchedWeather', 'true');
    setShowSuggestions(false);

    setTimeout(() => {
      navigate(createPageUrl(`LocationWeather?location=${encodeURIComponent(searchQuery)}`));
      setSearchQuery('');
      setSearching(false);
    }, 300);
  };

  const handleClose = () => {
    navigate(createPageUrl('Home'));
    setSearchQuery('');
    setShowSuggestions(false);
  };

  const isLocationWeatherPage = location.pathname.includes('LocationWeather');

  return (
    <>
      {/* Search Bar */}
      <motion.div
        initial={{ opacity: 0, x: 20 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ duration: 0.4 }}
        className="relative"
        onMouseEnter={() => expandOnHover && setHovering(true)}
        onMouseLeave={() => expandOnHover && setHovering(false)}
      >
        {/* Tooltip */}
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={hovering ? { opacity: 1, y: -40 } : { opacity: 0, y: -10 }}
          transition={{ duration: 0.2 }}
          pointerEvents="none"
          className={`hidden sm:block absolute -top-12 left-1/2 -translate-x-1/2 whitespace-nowrap text-xs rounded-lg px-3 py-1.5 transition-colors duration-300 ${
            isDark ? 'text-slate-400 bg-slate-800/90 border border-slate-700' : 'text-slate-600 bg-white/90 border border-slate-200'
          }`}
        >
          Search for your/a location for the local weather forecast
        </motion.div>

        <form onSubmit={handleSearch} className="relative" ref={suggestionsRef}>
            <div className="relative">
              <MapPin className={`absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 ${isDark ? 'text-slate-500' : 'text-gray-500'}`} />
              <input
                type="text"
                placeholder="Search location..."
                value={searchQuery}
                onChange={handleInputChange}
                onFocus={() => searchQuery.trim().length >= 2 && setShowSuggestions(true)}
                disabled={searching}
                className={`py-2 pl-10 pr-10 rounded-xl text-sm disabled:opacity-50 focus:outline-none focus:border-sky-500 transition-all duration-300 ${
                  expandOnHover
                    ? `hidden sm:block ${hovering || searchQuery ? 'w-72' : 'w-48'}`
                    : 'w-48 sm:w-64'
                } ${
                  isDark
                    ? 'bg-slate-700/50 border border-slate-600 text-white placeholder-slate-400 focus:bg-slate-700'
                    : 'bg-gray-100 border border-gray-300 text-slate-900 placeholder-gray-500 focus:bg-white'
                }`}
              />
            </div>
            <motion.button
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              type="submit"
              disabled={searching || !searchQuery.trim()}
              className={`absolute right-2.5 top-1/2 -translate-y-1/2 p-1.5 transition-colors disabled:opacity-50 ${
                isDark ? 'text-slate-400 hover:text-sky-400' : 'text-gray-500 hover:text-sky-600'
              }`}
            >
              <Search className="w-4 h-4" />
            </motion.button>

            {/* Suggestions Dropdown */}
            <AnimatePresence>
              {showSuggestions && suggestions.length > 0 && (
                <motion.div
                  initial={{ opacity: 0, y: -8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -8 }}
                  className={`absolute top-full left-0 right-0 mt-2 rounded-xl shadow-lg z-50 transition-colors duration-300 ${
                    isDark ? 'bg-slate-800 border border-slate-700' : 'bg-white border border-gray-200'
                  }`}
                >
                  {suggestions.map((suggestion, index) => (
                    <motion.button
                      key={index}
                      type="button"
                      onClick={() => handleSuggestionClick(suggestion)}
                      className={`w-full px-4 py-2.5 text-left text-sm flex items-center gap-2 transition-colors first:rounded-t-xl last:rounded-b-xl ${
                        isDark
                          ? 'text-slate-300 hover:bg-slate-700 hover:text-white'
                          : 'text-gray-700 hover:bg-gray-100 hover:text-slate-900'
                      }`}
                      whileHover={{ x: 4 }}
                    >
                      <MapPin className="w-3 h-3 flex-shrink-0 mt-0.5" />
                      <div className="flex flex-col min-w-0">
                        <span className="truncate">{suggestion.displayName}</span>
                        {suggestion.subtitle && (
                          <span className={`text-[10px] truncate ${isDark ? 'text-slate-500' : 'text-gray-400'}`}>{suggestion.subtitle}</span>
                        )}
                      </div>
                    </motion.button>
                  ))}
                </motion.div>
              )}
            </AnimatePresence>
          </form>
        </motion.div>

      {/* Error Toast */}
      {error && (
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -10 }}
          className="fixed top-20 right-4 z-50 flex items-center gap-2 bg-red-500/90 border border-red-400/50 text-white px-4 py-3 rounded-xl backdrop-blur-sm"
        >
          <AlertCircle className="w-4 h-4 flex-shrink-0" />
          <span className="text-sm">{error}</span>
        </motion.div>
      )}
    </>
  );
}