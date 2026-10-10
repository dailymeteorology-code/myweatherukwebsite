import React, { createContext, useState, useContext, useEffect, useCallback } from 'react';
import { base44 } from '@/api/base44Client';

/**
 * Self-hosted AuthContext.
 *
 * The Base44 original asked its cloud for the app's "public settings" to learn
 * whether the app required auth, then checked the user's token against that.
 * Self-hosted there is no such gatekeeper: the site is public, and the only
 * question is whether *this* visitor happens to be signed in — which decides
 * whether admin controls show. So the public-settings step becomes a local
 * constant and only the user check does any work.
 *
 * The exported surface is unchanged, because App.jsx and several components
 * destructure all of these.
 */

const AuthContext = createContext();

/** Stand-in for the cloud's per-app settings blob. The app only ever reads
 *  it truthily, to know the app finished bootstrapping. */
const LOCAL_APP_SETTINGS = {
  id: 'self-hosted',
  public_settings: { requires_auth: false, is_public: true },
};

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isLoadingAuth, setIsLoadingAuth] = useState(true);
  const [isLoadingPublicSettings, setIsLoadingPublicSettings] = useState(true);
  const [authError, setAuthError] = useState(null);
  const [appPublicSettings, setAppPublicSettings] = useState(null);

  const checkAppState = useCallback(async () => {
    setIsLoadingPublicSettings(true);
    setAuthError(null);

    // No remote app record to fetch — the site is whatever this box serves.
    setAppPublicSettings(LOCAL_APP_SETTINGS);
    setIsLoadingPublicSettings(false);

    setIsLoadingAuth(true);
    try {
      const currentUser = await base44.auth.me();
      setUser(currentUser);
      setIsAuthenticated(true);
    } catch (error) {
      // Signed out is the normal case for a public visitor, not an error worth
      // surfacing. Anything else (server down, bad response) is worth flagging.
      setUser(null);
      setIsAuthenticated(false);
      if (error?.status && error.status !== 401 && error.status !== 403) {
        setAuthError({
          type: 'unknown',
          message: error.message || 'Failed to load app',
        });
      }
    } finally {
      setIsLoadingAuth(false);
    }
  }, []);

  useEffect(() => {
    checkAppState();
  }, [checkAppState]);

  const logout = (shouldRedirect = true) => {
    setUser(null);
    setIsAuthenticated(false);
    if (shouldRedirect) base44.auth.logout(window.location.href);
    else base44.auth.logout();
  };

  const navigateToLogin = () => {
    base44.auth.redirectToLogin(window.location.href);
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        isAuthenticated,
        isLoadingAuth,
        isLoadingPublicSettings,
        authError,
        appPublicSettings,
        logout,
        navigateToLogin,
        checkAppState,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
