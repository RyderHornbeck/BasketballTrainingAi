import { Text } from "@/components/Text";
import { NormalizedSubscriptionPackage } from "@/lib/subscriptionFormatting";
import React from "react";
import { Pressable, StyleSheet } from "react-native";

interface PlanCardProps {
  plan: NormalizedSubscriptionPackage;
  selected: boolean;
  onPress: () => void;
  accentColor: string;
  textColor: string;
  backgroundColor: string;
  disabled?: boolean;
}

export function PlanCard({
  plan,
  selected,
  onPress,
  accentColor,
  textColor,
  backgroundColor,
  disabled,
}: PlanCardProps) {
  const title = plan.duration === "annual" ? "Annual" : "Monthly";
  const trialText =
    plan.hasEligibleFreeTrial && plan.introDurationCount && plan.introDurationUnit
      ? `${plan.introDurationCount} ${
          plan.introDurationUnit.charAt(0).toUpperCase() +
          plan.introDurationUnit.slice(1)
        } Free Trial`
      : null;

  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ selected, disabled }}
      accessibilityLabel={`${title}${trialText ? `, ${trialText}` : ""}`}
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
      <Text style={[styles.title, { color: textColor }]}>{title}</Text>
      {trialText ? (
        <Text style={[styles.trial, { color: accentColor }]}>{trialText}</Text>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    minHeight: 82,
    borderRadius: 22,
    paddingHorizontal: 17,
    paddingVertical: 14,
    justifyContent: "center",
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
});
