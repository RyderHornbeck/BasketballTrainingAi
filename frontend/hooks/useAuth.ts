import { supabase } from "@/lib/supabase";
import { Profile } from "@/types/database";
import * as AppleAuthentication from "expo-apple-authentication";
import * as Crypto from "expo-crypto";
import * as WebBrowser from "expo-web-browser";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Session, User } from "@supabase/supabase-js";
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { Platform } from "react-native";

WebBrowser.maybeCompleteAuthSession();
const GOOGLE_REDIRECT_URL = "hoopplan://auth/callback";

interface AuthContextValue {
  session: Session | null;
  user: User | null;
  profile: Profile | null;
  loading: boolean;
  startupError: string | null;
  signInWithGoogle: () => Promise<User | null>;
  signInWithApple: () => Promise<User | null>;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
  retryStartup: () => void;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);
const STARTUP_TIMEOUT_MS = 3_000;
const STARTUP_RETRY_ATTEMPTS = 2;
const PENDING_APPLE_NAME_PREFIX = "court-coach:pending-apple-name:";

function getDeviceTimezone(): string | null {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || null;
  } catch {
    return null;
  }
}

function withTimeout<T>(promise: PromiseLike<T>, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error(`${label} timed out. Check your connection and try again.`));
    }, STARTUP_TIMEOUT_MS);
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

function formatAppleName(
  name: AppleAuthentication.AppleAuthenticationFullName | null
): string | null {
  if (!name) return null;
  const fullName = [name.givenName, name.middleName, name.familyName]
    .filter((part): part is string => Boolean(part?.trim()))
    .join(" ")
    .trim();
  return fullName || null;
}

function isCanceledAuth(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const code = "code" in error
    ? String((error as { code?: unknown }).code ?? "").toUpperCase()
    : "";
  const message = error instanceof Error ? error.message.toLowerCase() : "";
  return (
    code === "ERR_REQUEST_CANCELED" ||
    code === "ERR_CANCELED" ||
    code === "1001" ||
    message.includes("authorization attempt was canceled") ||
    message.includes("authorization attempt was cancelled")
  );
}

async function appleNameStorageKey(appleUserId: string): Promise<string> {
  const userHash = await Crypto.digestStringAsync(
    Crypto.CryptoDigestAlgorithm.SHA256,
    appleUserId
  );
  return `${PENDING_APPLE_NAME_PREFIX}${userHash}`;
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

  const syncTimezone = useCallback(async (userId: string, currentTimezone: string | null) => {
    const deviceTimezone = getDeviceTimezone();
    if (!deviceTimezone || deviceTimezone === currentTimezone) return currentTimezone;
    const { error } = await supabase
      .from("profiles")
      .update({ timezone: deviceTimezone })
      .eq("id", userId);
    if (error) {
      console.warn("Unable to sync device timezone:", error.message);
      return currentTimezone;
    }
    return deviceTimezone;
  }, []);

  const ensureProfile = useCallback(async (user: User, appleName?: string | null) => {
    const metadataName =
      typeof user.user_metadata?.full_name === "string"
        ? user.user_metadata.full_name.trim()
        : typeof user.user_metadata?.name === "string"
          ? user.user_metadata.name.trim()
          : null;
    const fullName = appleName?.trim() || metadataName || null;
    if (fullName) {
      const { error } = await supabase
        .from("profiles")
        .update({ full_name: fullName })
        .eq("id", user.id);
      // Apple only returns the name during the first authorization. Name
      // persistence is optional and must never turn a successful Apple token
      // exchange into a failed sign-in.
      if (error) {
        console.warn("Unable to save social profile name:", error.message);
        return false;
      }
    }
    return true;
  }, []);

  useEffect(() => {
    let mounted = true;

    const init = async () => {
      setLoading(true);
      setStartupError(null);
      try {
        let lastError: unknown;

        for (let attempt = 1; attempt <= STARTUP_RETRY_ATTEMPTS; attempt += 1) {
          try {
            const { data, error } = await withTimeout(
              supabase.auth.getSession(),
              "Session loading"
            );
            if (error) throw error;
            if (!mounted) return;
            // Expose the locally restored session immediately so plan loading
            // can run in parallel with the profile request.
            setSession(data.session);

            const nextProfile = data.session?.user
              ? await loadProfile(data.session.user.id)
              : null;
            if (!mounted) return;
            setProfile(nextProfile);

            // Timezone persistence improves server-side day bucketing but is
            // not needed to choose the first screen. Do it after startup so it
            // does not hold the native splash for another network round trip.
            if (data.session?.user && nextProfile) {
              void syncTimezone(data.session.user.id, nextProfile.timezone)
                .then((timezone) => {
                  if (!mounted || timezone === nextProfile.timezone) return;
                  setProfile((current) =>
                    current?.id === nextProfile.id ? { ...current, timezone } : current
                  );
                })
                .catch((timezoneError) => {
                  console.warn("Timezone sync failed:", timezoneError);
                });
            }
            return;
          } catch (error) {
            lastError = error;
            const timedOut = error instanceof Error && error.message.includes("timed out");
            if (!timedOut || attempt === STARTUP_RETRY_ATTEMPTS) break;
            console.warn("App startup timed out; retrying immediately.");
          }
        }

        throw lastError;
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

    const syncSessionProfile = async (newSession: Session | null) => {
      if (!mounted) return;
      if (newSession?.user) {
        try {
          let nextProfile = await loadProfile(newSession.user.id);
          if (!mounted) return;
          if (nextProfile) {
            const timezone = await syncTimezone(newSession.user.id, nextProfile.timezone);
            if (!mounted) return;
            nextProfile = { ...nextProfile, timezone };
          }
          setProfile(nextProfile);
          setStartupError(null);
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
    };

    const { data: listener } = supabase.auth.onAuthStateChange((_event, newSession) => {
      if (!mounted) return;
      setSession(newSession);
      // Defer Supabase queries until after the auth callback releases its lock.
      setTimeout(() => {
        void syncSessionProfile(newSession);
      }, 0);
    });

    return () => {
      mounted = false;
      listener.subscription.unsubscribe();
    };
  }, [loadProfile, startupAttempt, syncTimezone]);

  const retryStartup = useCallback(() => {
    setStartupError(null);
    setLoading(true);
    setStartupAttempt((attempt) => attempt + 1);
  }, []);

  const signInWithGoogle = useCallback(async (): Promise<User | null> => {
    const { data, error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: GOOGLE_REDIRECT_URL,
        skipBrowserRedirect: true,
      },
    });
    if (error) throw error;
    if (!data.url) throw new Error("Google sign-in could not be started.");

    const result = await WebBrowser.openAuthSessionAsync(data.url, GOOGLE_REDIRECT_URL);
    if (result.type === "cancel" || result.type === "dismiss") return null;
    if (result.type !== "success" || !result.url) {
      throw new Error("Google sign-in did not complete. Please try again.");
    }

    const callbackUrl = new URL(result.url);
    const callbackError = callbackUrl.searchParams.get("error");
    if (callbackError === "access_denied") return null;
    if (callbackError) {
      throw new Error(
        callbackUrl.searchParams.get("error_description") || "Google sign-in was not completed."
      );
    }
    const code = callbackUrl.searchParams.get("code");
    if (!code) throw new Error("Google did not return a valid authorization code.");

    const { data: sessionData, error: exchangeError } =
      await supabase.auth.exchangeCodeForSession(code);
    if (exchangeError) throw exchangeError;
    if (!sessionData.user) throw new Error("Google sign-in did not return a user.");
    await ensureProfile(sessionData.user);
    return sessionData.user;
  }, [ensureProfile]);

  const signInWithApple = useCallback(async (): Promise<User | null> => {
    if (Platform.OS !== "ios") {
      throw new Error("Apple sign-in is available on iPhone and iPad only.");
    }
    if (!(await AppleAuthentication.isAvailableAsync())) {
      throw new Error("Apple sign-in is not available on this device.");
    }

    try {
      const nonceBytes = await Crypto.getRandomBytesAsync(32);
      const rawNonce = Array.from(nonceBytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
      const hashedNonce = await Crypto.digestStringAsync(
        Crypto.CryptoDigestAlgorithm.SHA256,
        rawNonce
      );
      const credential = await AppleAuthentication.signInAsync({
        requestedScopes: [
          AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
          AppleAuthentication.AppleAuthenticationScope.EMAIL,
        ],
        nonce: hashedNonce,
      });
      if (!credential.identityToken) {
        throw new Error("Apple did not return an identity token.");
      }
      const returnedAppleName = formatAppleName(credential.fullName);
      const pendingNameKey = await appleNameStorageKey(credential.user);
      if (returnedAppleName) {
        await AsyncStorage.setItem(pendingNameKey, returnedAppleName).catch(() => {});
      }
      const appleName =
        returnedAppleName ??
        (await AsyncStorage.getItem(pendingNameKey).catch(() => null));

      const { data, error } = await supabase.auth.signInWithIdToken({
        provider: "apple",
        token: credential.identityToken,
        nonce: rawNonce,
      });
      if (error) throw error;
      if (!data.user) throw new Error("Apple sign-in did not return a user.");

      // Apple may return the person's name only on the first authorization.
      const nameSaved = await ensureProfile(data.user, appleName);
      if (appleName && nameSaved) {
        await AsyncStorage.removeItem(pendingNameKey).catch(() => {});
      }
      return data.user;
    } catch (error) {
      if (isCanceledAuth(error)) return null;
      throw error;
    }
  }, [ensureProfile]);

  const signOut = useCallback(async () => {
    // A local sign-out is sufficient for a device logout and remains reliable
    // offline. SubscriptionProvider owns the corresponding RevenueCat logout
    // after the auth state changes, avoiding two native logout calls during the
    // same navigation teardown.
    const { error } = await supabase.auth.signOut({ scope: "local" });
    if (error) throw error;
  }, []);

  const refreshProfile = useCallback(async () => {
    const { data, error } = await supabase.auth.getUser();
    if (error) throw error;
    if (!data.user) {
      setProfile(null);
      return;
    }
    setProfile(await loadProfile(data.user.id));
  }, [loadProfile]);

  const value = useMemo<AuthContextValue>(
    () => ({
      session,
      user: session?.user ?? null,
      profile,
      loading,
      startupError,
      signInWithGoogle,
      signInWithApple,
      signOut,
      refreshProfile,
      retryStartup,
    }),
    [
      session,
      profile,
      loading,
      startupError,
      signInWithGoogle,
      signInWithApple,
      signOut,
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
