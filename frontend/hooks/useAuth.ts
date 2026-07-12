import { supabase } from "@/lib/supabase";
import { Profile } from "@/types/database";
import { Session, User } from "@supabase/supabase-js";
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

interface AuthContextValue {
  session: Session | null;
  user: User | null;
  profile: Profile | null;
  loading: boolean;
  startupError: string | null;
  signUp: (email: string, password: string) => Promise<void>;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  resetPassword: (email: string) => Promise<void>;
  refreshProfile: () => Promise<void>;
  retryStartup: () => void;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);
const STARTUP_TIMEOUT_MS = 10_000;

function withTimeout<T>(promise: PromiseLike<T>, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error(`${label} timed out. Check your connection and try again.`)),
      STARTUP_TIMEOUT_MS
    );
    Promise.resolve(promise).then(
      (value) => {
        clearTimeout(timeout);
        resolve(value);
      },
      (error) => {
        clearTimeout(timeout);
        reject(error);
      }
    );
  });
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [startupError, setStartupError] = useState<string | null>(null);
  const [startupAttempt, setStartupAttempt] = useState(0);

  const loadProfile = useCallback(async (userId: string) => {
    const { data, error } = await withTimeout(
      supabase.from("profiles").select("*").eq("id", userId).maybeSingle(),
      "Profile loading"
    );
    if (error) {
      throw error;
    }
    return data as Profile | null;
  }, []);

  useEffect(() => {
    let mounted = true;

    const init = async () => {
      setLoading(true);
      setStartupError(null);
      try {
        const { data, error } = await withTimeout(supabase.auth.getSession(), "Session loading");
        if (error) throw error;
        if (!mounted) return;

        setSession(data.session);
        if (data.session?.user) {
          const nextProfile = await loadProfile(data.session.user.id);
          if (!mounted) return;
          setProfile(nextProfile);
        } else {
          setProfile(null);
        }
      } catch (error) {
        if (!mounted) return;
        console.warn("App startup failed:", error);
        setProfile(null);
        setStartupError(
          error instanceof Error ? error.message : "App startup failed. Please try again."
        );
      } finally {
        if (mounted) setLoading(false);
      }
    };

    void init();

    const { data: listener } = supabase.auth.onAuthStateChange(async (_event, newSession) => {
      if (!mounted) return;
      setSession(newSession);
      if (newSession?.user) {
        try {
          const nextProfile = await loadProfile(newSession.user.id);
          if (mounted) {
            setProfile(nextProfile);
            setStartupError(null);
          }
        } catch (error) {
          if (mounted) {
            setProfile(null);
            setStartupError(
              error instanceof Error ? error.message : "Unable to refresh your profile."
            );
          }
        }
      } else {
        setProfile(null);
        setStartupError(null);
      }
    });

    return () => {
      mounted = false;
      listener.subscription.unsubscribe();
    };
  }, [loadProfile, startupAttempt]);

  const retryStartup = useCallback(() => {
    setStartupError(null);
    setLoading(true);
    setStartupAttempt((attempt) => attempt + 1);
  }, []);

  const signUp = useCallback(async (email: string, password: string) => {
    const { error } = await supabase.auth.signUp({ email, password });
    if (error) throw error;
  }, []);

  const signIn = useCallback(async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
  }, []);

  const signOut = useCallback(async () => {
    const { error } = await supabase.auth.signOut();
    if (error) throw error;
  }, []);

  const resetPassword = useCallback(async (email: string) => {
    const { error } = await supabase.auth.resetPasswordForEmail(email);
    if (error) throw error;
  }, []);

  const refreshProfile = useCallback(async () => {
    if (session?.user) await loadProfile(session.user.id);
  }, [session, loadProfile]);

  const value = useMemo<AuthContextValue>(
    () => ({
      session,
      user: session?.user ?? null,
      profile,
      loading,
      startupError,
      signUp,
      signIn,
      signOut,
      resetPassword,
      refreshProfile,
      retryStartup,
    }),
    [
      session,
      profile,
      loading,
      startupError,
      signUp,
      signIn,
      signOut,
      resetPassword,
      refreshProfile,
      retryStartup,
    ]
  );

  return React.createElement(AuthContext.Provider, { value }, children);
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within an AuthProvider");
  return ctx;
}
