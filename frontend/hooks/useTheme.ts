import { useThemeContext } from "@/components/ThemeProvider";

/** Convenience re-export so screens can `import { useTheme } from "@/hooks/useTheme"`. */
export function useTheme() {
  return useThemeContext();
}
