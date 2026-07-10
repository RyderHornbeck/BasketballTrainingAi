import { ThemeColors } from "@/components/ThemeProvider";
import { DarkTheme, DefaultTheme } from "expo-router";

export function buildNavigationTheme(scheme: "light" | "dark", colors: ThemeColors) {
  const base = scheme === "dark" ? DarkTheme : DefaultTheme;
  return {
    ...base,
    dark: scheme === "dark",
    colors: {
      ...base.colors,
      primary: colors.accent,
      background: colors.background,
      card: colors.card,
      text: colors.text,
      border: colors.border,
      notification: colors.danger,
    },
  };
}
