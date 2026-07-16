import { isDayUnlocked, PLAN_TOTAL_DAYS } from "@/lib/plan";
import { useTheme } from "@/hooks/useTheme";
import { WorkoutDay } from "@/types/database";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";
import { Text } from "./Text";

interface DaySelectorProps {
  days: WorkoutDay[];
  selectedDayNumber: number;
  currentDayNumber: number;
  onSelect: (dayNumber: number) => void;
}

const CELL_SIZE = 44;
const GAP = 12;
const STRIDE = CELL_SIZE + GAP;
const H_PADDING = 20;

function scrollOffsetForDay(dayNumber: number, viewportWidth: number): number {
  const index = Math.max(0, Math.min(PLAN_TOTAL_DAYS - 1, dayNumber - 1));
  const contentWidth =
    H_PADDING * 2 + PLAN_TOTAL_DAYS * CELL_SIZE + (PLAN_TOTAL_DAYS - 1) * GAP;
  const maxScroll = Math.max(0, contentWidth - viewportWidth);

  let anchorX = H_PADDING + 2 * STRIDE;
  if (index <= 0) {
    anchorX = H_PADDING;
  } else if (index === 1) {
    anchorX = H_PADDING + STRIDE;
  } else if (index >= PLAN_TOTAL_DAYS - 3) {
    anchorX = viewportWidth - H_PADDING - 2 * STRIDE;
  }

  const cellLeft = H_PADDING + index * STRIDE;
  return Math.max(0, Math.min(maxScroll, cellLeft - anchorX));
}

export function DaySelector({
  days,
  selectedDayNumber,
  currentDayNumber,
  onSelect,
}: DaySelectorProps) {
  const { colors, scheme } = useTheme();
  const scrollRef = useRef<ScrollView>(null);
  const [viewportWidth, setViewportWidth] = useState(0);

  const dayByNumber = useMemo(() => {
    const map = new Map<number, WorkoutDay>();
    for (const day of days) {
      if (day.day_number != null) map.set(day.day_number, day);
    }
    return map;
  }, [days]);

  const daySlots = useMemo(
    () => Array.from({ length: PLAN_TOTAL_DAYS }, (_, index) => index + 1),
    []
  );

  useEffect(() => {
    if (viewportWidth <= 0) return;
    const offset = scrollOffsetForDay(selectedDayNumber, viewportWidth);
    requestAnimationFrame(() => {
      scrollRef.current?.scrollTo({ x: offset, animated: true });
    });
  }, [selectedDayNumber, viewportWidth]);

  return (
    <View style={styles.wrapper}>
      <Text
        style={[
          styles.brand,
          { color: scheme === "light" ? colors.accent : colors.text },
        ]}
      >
        Court Coach
      </Text>
      <ScrollView
        ref={scrollRef}
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.scrollContent}
        style={styles.scroll}
        onLayout={(event) => setViewportWidth(event.nativeEvent.layout.width)}
        keyboardShouldPersistTaps="always"
        nestedScrollEnabled
      >
        {daySlots.map((dayNumber) => {
          const day = dayByNumber.get(dayNumber);
          const generated = day != null;
          const unlocked = generated && isDayUnlocked(day, days);
          const selectable = generated;
          const selected = dayNumber === selectedDayNumber;
          const isCurrent = dayNumber === currentDayNumber;
          const completed = day?.completed ?? false;

          let backgroundColor = colors.card;
          let borderColor = colors.border;
          let textColor = colors.text;

          if (selected) {
            backgroundColor = colors.accent;
            borderColor = colors.accent;
            textColor = "#FFFFFF";
          } else if (isCurrent) {
            backgroundColor = colors.accentMuted;
            borderColor = colors.accent;
            textColor = colors.accent;
          } else if (completed) {
            backgroundColor = colors.accentMuted;
            borderColor = colors.border;
            textColor = colors.accent;
          }

          return (
            <Pressable
              key={dayNumber}
              disabled={!generated}
              onPress={() => onSelect(dayNumber)}
              hitSlop={6}
              style={[
                styles.circle,
                {
                  backgroundColor,
                  borderColor,
                  borderWidth: isCurrent && !selected ? 2 : 1.5,
                  opacity: selectable ? 1 : generated ? 0.45 : 0.28,
                },
                selected && styles.circleSelectedShadow,
              ]}
            >
              <Text style={[styles.circleText, { color: textColor }]}>{dayNumber}</Text>
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
    gap: GAP,
    paddingHorizontal: H_PADDING,
    paddingVertical: 14,
    alignItems: "center",
  },
  circle: {
    width: CELL_SIZE,
    height: CELL_SIZE,
    borderRadius: CELL_SIZE / 2,
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
