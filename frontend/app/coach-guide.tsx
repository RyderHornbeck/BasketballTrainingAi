import { CoachIntroScreen } from "@/components/CoachOverlay";
import { useAuth } from "@/hooks/useAuth";
import { useTheme } from "@/hooks/useTheme";
import { router } from "expo-router";
import React, { useState } from "react";

export default function CoachGuideScreen() {
  const { colors } = useTheme();
  const { profile } = useAuth();
  const [mode, setMode] = useState<"voice" | "video">("video");
  const athleteName =
    profile?.preferred_name?.trim().split(/\s+/)[0] ||
    profile?.full_name?.trim().split(/\s+/)[0] ||
    "there";

  return (
    <CoachIntroScreen
      mode={mode}
      dark={mode === "voice" && colors.text === "#FFFFFF"}
      athleteName={athleteName}
      backgroundColor={colors.background}
      onBack={() => router.replace("/(tabs)/profile")}
      onSelectMode={setMode}
    />
  );
}
