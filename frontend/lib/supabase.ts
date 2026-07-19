import AsyncStorage from "@react-native-async-storage/async-storage";
import { createClient } from "@supabase/supabase-js";
import { AppState, Platform } from "react-native";
import "react-native-url-polyfill/auto";
import { reportNetworkFailure } from "./connectivity";

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    "Missing EXPO_PUBLIC_SUPABASE_URL or EXPO_PUBLIC_SUPABASE_ANON_KEY. Check frontend/.env."
  );
}

// Expo Router's static export can evaluate modules in Node where `window` is
// undefined. On native + Expo web we always persist the JWT in AsyncStorage.
const isSSR = Platform.OS === "web" && typeof window === "undefined";

const noopStorage = {
  getItem: (_key: string) => Promise.resolve(null),
  setItem: (_key: string, _value: string) => Promise.resolve(),
  removeItem: (_key: string) => Promise.resolve(),
};

const connectivityFetch: typeof fetch = async (...args) => {
  try {
    return await fetch(...args);
  } catch (error) {
    reportNetworkFailure("supabase");
    throw error;
  }
};

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  global: {
    fetch: connectivityFetch,
  },
  auth: {
    storage: isSSR ? noopStorage : AsyncStorage,
    autoRefreshToken: !isSSR,
    persistSession: true,
    detectSessionInUrl: false,
    flowType: "pkce",
  },
});

// Keep the refresh token alive while the app is in the foreground.
if (Platform.OS !== "web") {
  AppState.addEventListener("change", (state) => {
    if (state === "active") {
      supabase.auth.startAutoRefresh();
    } else {
      supabase.auth.stopAutoRefresh();
    }
  });
}
