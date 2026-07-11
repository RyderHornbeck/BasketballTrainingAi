import { isDayUnlocked } from "@/lib/plan";
import { useTheme } from "@/hooks/useTheme";
import { WorkoutDay } from "@/types/database";
import React, { useEffect, useRef, useState } from "react";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";
import { Text } from "./Text";

interface DaySelectorProps {
  days: WorkoutDay[];
  selectedDayNumber: number;
  onSelect: (dayNumber: number) => void;
}

export function DaySelector({ days, selectedDayNumber, onSelect }: DaySelectorProps) {
  const { colors, scheme } = useTheme();
  const scrollRef = useRef<ScrollView>(null);
  const [viewportWidth, setViewportWidth] = useState(0);

  const selectedDay = days.find((day) => day.day_number === selectedDayNumber);
  const currentBlock =
    selectedDay?.block_index ??
    days.find((day) => !day.completed)?.block_index ??
    Math.max(1, ...days.map((day) => day.block_index ?? 1));
  const sorted = days
    .filter((day) => (day.block_index ?? 1) === currentBlock)
    .sort((a, b) => (a.day_number ?? 0) - (b.day_number ?? 0));
  const selectedIndex = sorted.findIndex((day) => day.day_number === selectedDayNumber);

  useEffect(() => {
    if (viewportWidth <= 0 || selectedIndex < 0) return;
    requestAnimationFrame(() => {
      scrollRef.current?.scrollTo({
        x: selectedIndex * (44 + 12),
        animated: true,
      });
    });
  }, [selectedIndex, viewportWidth]);

  return (
    <View style={styles.wrapper}>
      <Text
        style={[
          styles.brand,
          { color: scheme === "light" ? colors.accent : colors.text },
        ]}
      >
        HoopPlan
      </Text>
    <ScrollView
      ref={scrollRef}
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={[
        styles.scrollContent,
        { paddingHorizontal: Math.max(20, viewportWidth / 2 - 22) },
      ]}
      style={styles.scroll}
      onLayout={(event) => setViewportWidth(event.nativeEvent.layout.width)}
      keyboardShouldPersistTaps="always"
      nestedScrollEnabled
    >
      {sorted.map((day) => {
        const unlocked = isDayUnlocked(day);
        const selected = day.day_number === selectedDayNumber;
        const completed = day.completed;

        return (
          <Pressable
            key={day.id}
            onPress={() => day.day_number != null && onSelect(day.day_number)}
            hitSlop={6}
            style={[
              styles.circle,
              {
                backgroundColor: selected ? colors.accent : completed ? colors.accentMuted : colors.card,
                borderColor: selected ? colors.accent : colors.border,
                opacity: unlocked ? 1 : 0.4,
              },
              selected && styles.circleSelectedShadow,
            ]}
          >
            <Text
              style={[
                styles.circleText,
                { color: selected ? "#FFFFFF" : completed ? colors.accent : colors.text },
              ]}
            >
              {day.day_number}
            </Text>
          </Pressable>
        );
      })}
    </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    zIndex: 20,
    elevation: 20,
  },
  brand: {
    fontSize: 28,
    fontWeight: "800",
    letterSpacing: -0.6,
    paddingHorizontal: 20,
    paddingTop: 4,
    paddingBottom: 2,
  },
  scroll: {
    flexGrow: 0,
  },
  scrollContent: {
    gap: 12,
    paddingHorizontal: 20,
    paddingVertical: 14,
    alignItems: "center",
  },
  circle: {
    width: 44,
    height: 44,
    borderRadius: 22,
    borderWidth: 1.5,
    alignItems: "center",
    justifyContent: "center",
  },
  circleSelectedShadow: {
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 8,
    elevation: 4,
  },
  circleText: {
    fontSize: 16,
    fontWeight: "700",
  },
});
