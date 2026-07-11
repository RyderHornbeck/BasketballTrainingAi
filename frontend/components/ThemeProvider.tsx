import AsyncStorage from "@react-native-async-storage/async-storage";
import React, { createContext, useContext, useEffect, useMemo, useState } from "react";
import { useColorScheme } from "react-native";

export type ThemeMode = "system" | "light" | "dark";
export type ResolvedScheme = "light" | "dark";

export interface ThemeColors {
  background: string;
  card: string;
  cardAlt: string;
  border: string;
  text: string;
  textSecondary: string;
  textMuted: string;
  accent: string;
  accentMuted: string;
  success: string;
  danger: string;
  warning: string;
  overlay: string;
  /** Soft top-of-screen tint used to build the subtle background gradient glow. */
  gradientGlow: string;
  /** Muted track color for progress bars / incomplete steps. */
  progressTrack: string;
  /** Shadow tint for elevated cards and inputs. */
  shadow: string;
}

const darkColors: ThemeColors = {
  background: "#0B0B0C",
  card: "#1C1C1E",
  cardAlt: "#242426",
  border: "#2E2E30",
  text: "#FFFFFF",
  textSecondary: "#C7C7CC",
  textMuted: "#8E8E93",
  accent: "#FF7A1A",
  accentMuted: "#3A2A18",
  success: "#34C759",
  danger: "#FF453A",
  warning: "#FFD60A",
  overlay: "rgba(0,0,0,0.6)",
  gradientGlow: "rgba(255,122,26,0.10)",
  progressTrack: "#2A2A2D",
  shadow: "#000000",
};

const lightColors: ThemeColors = {
  background: "#EBEBF0",
  card: "#FFFFFF",
  cardAlt: "#F5F5F7",
  border: "#E1E1E4",
  text: "#111113",
  textSecondary: "#48484A",
  textMuted: "#8E8E93",
  accent: "#FF7A1A",
  accentMuted: "#FFE3CC",
  success: "#248A3D",
  danger: "#D70015",
  warning: "#B25000",
  overlay: "rgba(0,0,0,0.35)",
  gradientGlow: "rgba(255,122,26,0.09)",
  progressTrack: "#E4E4E7",
  shadow: "#1A1A1A",
};

interface ThemeContextValue {
  mode: ThemeMode;
  scheme: ResolvedScheme;
  colors: ThemeColors;
  setMode: (mode: ThemeMode) => void;
}

const ThemeContext = createContext<ThemeContextValue | undefined>(undefined);

const STORAGE_KEY = "hoopplan-theme-mode";

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const systemScheme = useColorScheme();
  const [mode, setModeState] = useState<ThemeMode>("system");

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY).then((stored) => {
      if (stored === "light" || stored === "dark" || stored === "system") {
        setModeState(stored);
      }
    });
  }, []);

  const setMode = (next: ThemeMode) => {
    setModeState(next);
    AsyncStorage.setItem(STORAGE_KEY, next).catch(() => {});
  };

  const scheme: ResolvedScheme =
    mode === "system" ? (systemScheme === "dark" ? "dark" : "light") : mode;
  const colors = scheme === "dark" ? darkColors : lightColors;

  const value = useMemo<ThemeContextValue>(
    () => ({ mode, scheme, colors, setMode }),
    [mode, scheme, colors]
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useThemeContext(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useThemeContext must be used within a ThemeProvider");
  return ctx;
}
