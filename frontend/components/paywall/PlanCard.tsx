import { Text } from "@/components/Text";
import { NormalizedSubscriptionPackage } from "@/lib/subscriptionFormatting";
import React from "react";
import { Pressable, StyleSheet, View } from "react-native";

interface PlanCardProps {
  plan: NormalizedSubscriptionPackage;
  selected: boolean;
  onPress: () => void;
  accentColor: string;
  textColor: string;
  mutedColor: string;
  backgroundColor: string;
  badge?: string | null;
  disabled?: boolean;
}

export function PlanCard({
  plan,
  selected,
  onPress,
  accentColor,
  textColor,
  mutedColor,
  backgroundColor,
  badge,
  disabled,
}: PlanCardProps) {
  const title = plan.duration === "annual" ? "Annual" : "Monthly";

  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ selected, disabled }}
      accessibilityLabel={`${title}, ${plan.localizedRegularPrice} per ${plan.periodLabel}${
        badge ? `, ${badge}` : ""
      }`}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.card,
        {
          backgroundColor,
          borderColor: selected ? accentColor : "rgba(90,90,95,0.22)",
          borderWidth: selected ? 2.5 : 1.5,
          opacity: disabled ? 0.55 : pressed ? 0.86 : 1,
        },
      ]}
    >
      <View style={styles.headingRow}>
        <View>
          <Text style={[styles.title, { color: textColor }]}>{title}</Text>
          {plan.hasEligibleFreeTrial && plan.trialLabel ? (
            <Text style={[styles.trial, { color: accentColor }]}>{plan.trialLabel}</Text>
          ) : null}
        </View>
        {badge ? (
          <View style={[styles.badge, { backgroundColor: accentColor }]}>
            <Text style={styles.badgeText}>{badge}</Text>
          </View>
        ) : null}
      </View>
      <View style={styles.priceRow}>
        <Text style={[styles.price, { color: textColor }]}>
          {plan.localizedRegularPrice}
        </Text>
        <Text style={[styles.period, { color: mutedColor }]}> / {plan.periodLabel}</Text>
      </View>
      {plan.duration === "annual" && plan.localizedMonthlyEquivalent ? (
        <Text style={[styles.equivalent, { color: mutedColor }]}>
          {plan.localizedMonthlyEquivalent} per month
        </Text>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    minHeight: 112,
    borderRadius: 22,
    paddingHorizontal: 17,
    paddingVertical: 14,
  },
  headingRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: 8,
  },
  title: {
    fontSize: 17,
    fontWeight: "800",
  },
  trial: {
    marginTop: 1,
    fontSize: 11,
    fontWeight: "700",
  },
  badge: {
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  badgeText: {
    color: "#FFFFFF",
    fontSize: 10,
    fontWeight: "800",
  },
  priceRow: {
    marginTop: 11,
    flexDirection: "row",
    alignItems: "baseline",
  },
  price: {
    fontSize: 20,
    fontWeight: "800",
  },
  period: {
    fontSize: 12,
    fontWeight: "600",
  },
  equivalent: {
    marginTop: 1,
    fontSize: 11,
  },
});
