import { PaywallState } from "@/components/paywall/PaywallState";
import { PlanCard } from "@/components/paywall/PlanCard";
import { TimelineItem } from "@/components/paywall/TimelineItem";
import { Text } from "@/components/Text";
import { useAuth } from "@/hooks/useAuth";
import { useSubscription } from "@/hooks/useSubscription";
import { actionHaptic, completionHaptic, selectionHaptic } from "@/lib/haptics";
import { PRIVACY_POLICY_URL, TERMS_OF_SERVICE_URL } from "@/lib/legal";
import {
  getIntroEligibility,
  hasPremiumEntitlement,
  isPurchaseCancelled,
  logRevenueCatError,
  RevenueCatConfigurationError,
  revenueCatErrorMessage,
  trackRevenueCatPaywallImpression,
} from "@/lib/revenueCat";
import {
  calculateAnnualSavingsPercent,
  calculateDiscountPercent,
  formatSubscriptionDate,
  normalizeSubscriptionPackage,
  NormalizedSubscriptionPackage,
  parseIso8601Period,
  SubscriptionDuration,
} from "@/lib/subscriptionFormatting";
import { Redirect, router, useLocalSearchParams } from "expo-router";
import { StatusBar } from "expo-status-bar";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Animated,
  Image,
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from "react-native";
import {
  IntroEligibility,
  PurchasesOffering,
  PurchasesOfferings,
  PurchasesPackage,
} from "react-native-purchases";
import { SafeAreaView } from "react-native-safe-area-context";

type PaywallMode = "default" | "deal";
type PaywallStatus = "loading" | "ready" | "purchasing" | "restoring" | "success" | "error";

const DEFAULT_COLORS = {
  background: "#FFF2E7",
  card: "#FFFFFF",
  text: "#17120F",
  muted: "#6D625D",
  accent: "#FF7A1A",
};

const DEAL_COLORS = {
  background: "#FFFFFF",
  card: "#F7F4FF",
  text: "#18131F",
  muted: "#696070",
  accent: "#7048E8",
};

function durationForPackage(item: PurchasesPackage): SubscriptionDuration | null {
  const packageType = String(item.packageType).toUpperCase();
  if (packageType.includes("ANNUAL")) return "annual";
  if (packageType.includes("MONTHLY")) return "monthly";
  const period = parseIso8601Period(item.product.subscriptionPeriod);
  if (period?.unit === "year") return "annual";
  if (period?.unit === "month" && period.count === 1) return "monthly";
  return null;
}

function packagesForOffering(offering: PurchasesOffering): {
  item: PurchasesPackage;
  duration: SubscriptionDuration;
}[] {
  const byDuration = new Map<SubscriptionDuration, PurchasesPackage>();
  for (const item of offering.availablePackages) {
    const duration = durationForPackage(item);
    if (duration && !byDuration.has(duration)) byDuration.set(duration, item);
  }
  return (["annual", "monthly"] as const)
    .map((duration) => {
      const item = byDuration.get(duration);
      return item ? { item, duration } : null;
    })
    .filter(
      (entry): entry is { item: PurchasesPackage; duration: SubscriptionDuration } =>
        entry !== null
    );
}

function logPaywallEvent(event: string, data?: Record<string, string | null>) {
  if (__DEV__) console.info(`[paywall] ${event}`, data ?? {});
}

export default function PaywallScreen() {
  const { next } = useLocalSearchParams<{ next?: string | string[] }>();
  const continuation = (Array.isArray(next) ? next[0] : next) === "finish-setup"
    ? "finish-setup"
    : "app";
  const { user, signOut } = useAuth();
  const {
    hasPremium,
    subscriptionError,
    refreshCustomerInfo,
    refreshOfferings,
    restorePurchases,
    purchasePackage,
  } = useSubscription();
  const [mode, setMode] = useState<PaywallMode>("default");
  const [status, setStatus] = useState<PaywallStatus>("loading");
  const [offering, setOffering] = useState<PurchasesOffering | null>(null);
  const [defaultOffering, setDefaultOffering] = useState<PurchasesOffering | null>(null);
  const [eligibility, setEligibility] = useState<Record<string, IntroEligibility>>({});
  const [selectedDuration, setSelectedDuration] =
    useState<SubscriptionDuration>("annual");
  const [message, setMessage] = useState<string | null>(null);
  const [contentOpacity] = useState(() => new Animated.Value(0));
  const requestLockRef = useRef(false);
  const impressionIdsRef = useRef(new Set<string>());

  const palette = mode === "deal" ? DEAL_COLORS : DEFAULT_COLORS;

  const continueToApp = useCallback((event = "purchase_completed") => {
    setStatus("success");
    if (event !== "entitlement_active") completionHaptic();
    logPaywallEvent(event, { continuation });
    router.replace(continuation === "finish-setup" ? "/finish-setup" : "/");
  }, [continuation]);

  useEffect(() => {
    if (hasPremium && !requestLockRef.current) continueToApp("entitlement_active");
  }, [continueToApp, hasPremium]);

  const loadPaywall = useCallback(async () => {
    setStatus("loading");
    setMessage(null);
    try {
      const allOfferings: PurchasesOfferings = await refreshOfferings();
      const baseline =
        allOfferings.current?.identifier === "default"
          ? allOfferings.current
          : allOfferings.all.default ?? null;
      const target =
        mode === "deal"
          ? allOfferings.all.deal ?? null
          : baseline;
      if (!target) {
        throw new RevenueCatConfigurationError(
          __DEV__
            ? mode === "deal"
              ? "The deal offering is not configured in RevenueCat."
              : "The default offering is not configured in RevenueCat."
            : "Subscriptions are temporarily unavailable. Please try again later."
        );
      }
      const available = packagesForOffering(target);
      if (available.length === 0) {
        throw new RevenueCatConfigurationError(
          __DEV__
            ? "Add an annual or monthly package to this RevenueCat offering."
            : "Subscriptions are temporarily unavailable. Please try again later."
        );
      }
      const nextEligibility = await getIntroEligibility(
        available.map((entry) => entry.item)
      );
      setDefaultOffering(baseline);
      setOffering(target);
      setEligibility(nextEligibility);
      setSelectedDuration((current) =>
        available.some((entry) => entry.duration === current)
          ? current
          : available[0].duration
      );
      setStatus("ready");
      logPaywallEvent("paywall_viewed", { mode, offeringId: target.identifier });
      if (!impressionIdsRef.current.has(target.identifier)) {
        impressionIdsRef.current.add(target.identifier);
        void trackRevenueCatPaywallImpression(target.identifier, target).catch((error) => {
          logRevenueCatError("RevenueCat impression failed", error, {
            offeringId: target.identifier,
          });
        });
      }
    } catch (error) {
      logRevenueCatError("RevenueCat offering load failed", error);
      setMessage(revenueCatErrorMessage(error));
      setStatus("error");
    }
  }, [mode, refreshOfferings]);

  useEffect(() => {
    if (!user || hasPremium) return;
    const frame = requestAnimationFrame(() => {
      void loadPaywall();
    });
    return () => cancelAnimationFrame(frame);
  }, [hasPremium, loadPaywall, user]);

  useEffect(() => {
    if (status === "loading") {
      contentOpacity.setValue(0);
      return;
    }
    if (status === "ready") {
      Animated.timing(contentOpacity, {
        toValue: 1,
        duration: 220,
        useNativeDriver: true,
      }).start();
    }
  }, [contentOpacity, status]);

  const plans = useMemo<NormalizedSubscriptionPackage[]>(() => {
    if (!offering) return [];
    return packagesForOffering(offering).map(({ item, duration }) =>
      normalizeSubscriptionPackage(item, duration, eligibility[item.product.identifier])
    );
  }, [eligibility, offering]);

  const selectedPlan =
    plans.find((plan) => plan.duration === selectedDuration) ?? plans[0] ?? null;
  const annualPlan = plans.find((plan) => plan.duration === "annual");
  const monthlyPlan = plans.find((plan) => plan.duration === "monthly");
  const annualSavings = annualPlan
    ? calculateAnnualSavingsPercent(annualPlan.regularPrice, monthlyPlan?.regularPrice)
    : null;

  const defaultPrices = useMemo(() => {
    const prices = new Map<SubscriptionDuration, number>();
    if (!defaultOffering) return prices;
    for (const entry of packagesForOffering(defaultOffering)) {
      prices.set(entry.duration, entry.item.product.price);
    }
    return prices;
  }, [defaultOffering]);

  const badgeForPlan = (plan: NormalizedSubscriptionPackage): string | null => {
    if (mode === "deal") {
      const discount = calculateDiscountPercent(
        defaultPrices.get(plan.duration),
        plan.regularPrice
      );
      if (discount) return `${discount}% OFF`;
    }
    if (plan.duration === "annual" && annualSavings) return `SAVE ${annualSavings}%`;
    return null;
  };

  const verifyAndContinue = useCallback(
    async (customerInfo: Awaited<ReturnType<typeof refreshCustomerInfo>>) => {
      let verifiedInfo = customerInfo;
      if (!hasPremiumEntitlement(verifiedInfo)) {
        verifiedInfo = await refreshCustomerInfo();
      }
      if (!hasPremiumEntitlement(verifiedInfo)) {
        throw new Error(
          "Apple completed the transaction, but premium access is not active yet. Try Restore Purchases."
        );
      }
      continueToApp();
    },
    [continueToApp, refreshCustomerInfo]
  );

  const handlePurchase = async () => {
    if (!selectedPlan || requestLockRef.current) return;
    requestLockRef.current = true;
    actionHaptic();
    setStatus("purchasing");
    setMessage(null);
    try {
      const customerInfo = await purchasePackage(selectedPlan.package);
      await verifyAndContinue(customerInfo);
    } catch (error) {
      if (isPurchaseCancelled(error)) {
        logPaywallEvent("purchase_cancelled", {
          mode,
          offeringId: offering?.identifier ?? null,
          packageId: selectedPlan.package.identifier,
        });
        let refreshed = null;
        try {
          refreshed = await refreshCustomerInfo();
        } catch {}
        if (hasPremiumEntitlement(refreshed)) {
          continueToApp();
        } else if (mode === "default") {
          setMode("deal");
          setStatus("loading");
        } else {
          setStatus("ready");
        }
      } else {
        logRevenueCatError("RevenueCat purchase failed", error, {
          offeringId: offering?.identifier,
          packageId: selectedPlan.package.identifier,
          productId: selectedPlan.package.product.identifier,
        });
        setMessage(revenueCatErrorMessage(error));
        setStatus("ready");
      }
    } finally {
      requestLockRef.current = false;
    }
  };

  const handleRestore = async () => {
    if (requestLockRef.current) return;
    requestLockRef.current = true;
    actionHaptic();
    setStatus("restoring");
    setMessage(null);
    logPaywallEvent("restore_started", { mode });
    try {
      const customerInfo = await restorePurchases();
      let verifiedInfo = customerInfo;
      if (!hasPremiumEntitlement(verifiedInfo)) {
        verifiedInfo = await refreshCustomerInfo();
      }
      if (!hasPremiumEntitlement(verifiedInfo)) {
        setMessage("No active Court Coach subscription was found for this Apple account.");
        setStatus("ready");
        logPaywallEvent("restore_no_subscription", { mode });
        return;
      }
      continueToApp("restore_completed");
    } catch (error) {
      logRevenueCatError("RevenueCat restore failed", error, {
        offeringId: offering?.identifier,
      });
      setMessage(revenueCatErrorMessage(error));
      setStatus("ready");
    } finally {
      requestLockRef.current = false;
    }
  };

  const handleSignOut = async () => {
    if (requestLockRef.current) return;
    requestLockRef.current = true;
    actionHaptic();
    try {
      await signOut();
      router.replace("/welcome");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to sign out.");
      setStatus("error");
    } finally {
      requestLockRef.current = false;
    }
  };

  const openLegal = async (url: string) => {
    try {
      await Linking.openURL(url);
    } catch {
      setMessage("Unable to open that link right now.");
    }
  };

  if (!user) return <Redirect href="/welcome" />;

  const isWorking = status === "purchasing" || status === "restoring" || status === "success";
  const trialDate =
    selectedPlan?.trialEndDate && formatSubscriptionDate(selectedPlan.trialEndDate);
  const renewalDate =
    selectedPlan?.renewalDate && formatSubscriptionDate(selectedPlan.renewalDate);
  const timeline = selectedPlan?.hasEligibleFreeTrial
    ? [
        {
          title: "Today",
          description: "Unlock your personalized plans and live AI coach.",
        },
        {
          title: trialDate ? `On ${trialDate}` : "When your trial ends",
          description: `Your ${selectedPlan.trialDurationText ?? "free"} trial ends.`,
        },
        {
          title: "Then",
          description: `${selectedPlan.localizedRegularPrice} per ${selectedPlan.periodLabel} unless canceled.`,
        },
      ]
    : selectedPlan
      ? [
          {
            title: "Today",
            description: "Unlock your personalized plans and live AI coach.",
          },
          {
            title: "Secure Apple billing",
            description: `Subscribe for ${selectedPlan.localizedRegularPrice} per ${selectedPlan.periodLabel}.`,
          },
          {
            title: renewalDate ? `Renews ${renewalDate}` : "Automatic renewal",
            description: "Keep premium access until you cancel in your Apple subscriptions.",
          },
        ]
      : [];
  const cta = selectedPlan?.hasEligibleFreeTrial && selectedPlan.trialLabel
    ? `Start ${selectedPlan.trialLabel}`
    : selectedPlan
      ? `Continue with ${selectedPlan.duration === "annual" ? "Annual" : "Monthly"}`
      : "Continue";

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: palette.background }]}>
      <StatusBar style="dark" />
      {status === "loading" ? (
        <PaywallState
          kind="loading"
          textColor={palette.text}
          mutedColor={palette.muted}
          accentColor={palette.accent}
        />
      ) : status === "error" ? (
        <PaywallState
          kind="error"
          textColor={palette.text}
          mutedColor={palette.muted}
          accentColor={palette.accent}
          message={message ?? subscriptionError}
          onRetry={() => void loadPaywall()}
          onSignOut={() => void handleSignOut()}
        />
      ) : (
        <Animated.View style={[styles.safeArea, { opacity: contentOpacity }]}>
          <ScrollView
            contentContainerStyle={styles.content}
            showsVerticalScrollIndicator={false}
          >
            <Image
              accessible
              accessibilityLabel="Court Coach AI"
              source={require("../assets/images/AppLogo.png")}
              resizeMode="contain"
              style={styles.logo}
            />
            {mode === "deal" ? (
              <View style={[styles.dealPill, { backgroundColor: palette.accent }]}>
                <Text style={styles.dealPillText}>SPECIAL OFFER</Text>
              </View>
            ) : null}
            <Text style={[styles.title, { color: palette.text }]}>
              {mode === "deal"
                ? "Wait — keep Court Coach for less"
                : "Your smarter workout starts now"}
            </Text>
            <Text style={[styles.subtitle, { color: palette.muted }]}>
              Adaptive workouts, easier tracking, and a live coach that keeps every session moving.
            </Text>

            {timeline.map((item, index) => (
              <TimelineItem
                key={`${item.title}-${index}`}
                step={index + 1}
                title={item.title}
                description={item.description}
                accentColor={palette.accent}
                textColor={palette.text}
                mutedColor={palette.muted}
                isLast={index === timeline.length - 1}
              />
            ))}

            <View accessibilityRole="radiogroup" style={styles.plans}>
              {plans.map((plan) => (
                <PlanCard
                  key={plan.package.identifier}
                  plan={plan}
                  selected={plan.duration === selectedPlan?.duration}
                  onPress={() => {
                    selectionHaptic();
                    setSelectedDuration(plan.duration);
                  }}
                  accentColor={palette.accent}
                  textColor={palette.text}
                  mutedColor={palette.muted}
                  backgroundColor={palette.card}
                  badge={badgeForPlan(plan)}
                  disabled={isWorking}
                />
              ))}
            </View>

            {message ? (
              <Text accessibilityRole="alert" style={styles.operationMessage}>
                {message}
              </Text>
            ) : null}
            <Text style={[styles.cancelText, { color: palette.muted }]}>Cancel anytime.</Text>
            <Text style={[styles.billingText, { color: palette.muted }]}>
              Payment is charged to your Apple ID. Subscriptions renew automatically unless canceled.
            </Text>
          </ScrollView>

          <View
            style={[
              styles.bottomBar,
              {
                backgroundColor: palette.background,
                borderTopColor: mode === "deal" ? "#EEE8FA" : "#F0D9C7",
              },
            ]}
          >
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ disabled: isWorking || !selectedPlan }}
              disabled={isWorking || !selectedPlan}
              onPress={() => void handlePurchase()}
              style={({ pressed }) => [
                styles.purchaseButton,
                {
                  backgroundColor: palette.accent,
                  opacity: isWorking || !selectedPlan ? 0.55 : pressed ? 0.84 : 1,
                },
              ]}
            >
              <Text style={styles.purchaseText}>
                {status === "purchasing"
                  ? "Completing Purchase…"
                  : status === "restoring"
                    ? "Restoring…"
                    : cta}
              </Text>
            </Pressable>
            <View style={styles.linkRow}>
              <Pressable
                accessibilityRole="button"
                disabled={isWorking}
                onPress={() => void handleRestore()}
                hitSlop={8}
              >
                <Text style={[styles.link, { color: palette.muted }]}>Restore</Text>
              </Pressable>
              <Pressable
                accessibilityRole="link"
                onPress={() => void openLegal(TERMS_OF_SERVICE_URL)}
                hitSlop={8}
              >
                <Text style={[styles.link, { color: palette.muted }]}>Terms</Text>
              </Pressable>
              <Pressable
                accessibilityRole="link"
                onPress={() => void openLegal(PRIVACY_POLICY_URL)}
                hitSlop={8}
              >
                <Text style={[styles.link, { color: palette.muted }]}>Privacy</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                disabled={isWorking}
                onPress={() => void handleSignOut()}
                hitSlop={8}
              >
                <Text style={[styles.link, { color: palette.muted }]}>Sign Out</Text>
              </Pressable>
            </View>
          </View>
        </Animated.View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
  },
  content: {
    paddingHorizontal: 22,
    paddingTop: 8,
    paddingBottom: 18,
  },
  logo: {
    alignSelf: "center",
    width: 70,
    height: 70,
  },
  dealPill: {
    alignSelf: "center",
    marginTop: 8,
    borderRadius: 999,
    paddingHorizontal: 13,
    paddingVertical: 5,
  },
  dealPillText: {
    color: "#FFFFFF",
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 1,
  },
  title: {
    marginTop: 12,
    fontSize: 27,
    lineHeight: 34,
    fontWeight: "800",
    textAlign: "center",
  },
  subtitle: {
    marginTop: 7,
    marginBottom: 22,
    fontSize: 13,
    lineHeight: 20,
    textAlign: "center",
  },
  plans: {
    gap: 11,
    marginTop: 3,
  },
  operationMessage: {
    marginTop: 12,
    color: "#B42318",
    fontSize: 12,
    lineHeight: 18,
    fontWeight: "600",
    textAlign: "center",
  },
  cancelText: {
    marginTop: 14,
    fontSize: 12,
    fontWeight: "700",
    textAlign: "center",
  },
  billingText: {
    marginTop: 4,
    fontSize: 9,
    lineHeight: 14,
    textAlign: "center",
  },
  bottomBar: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 22,
    paddingTop: 12,
    paddingBottom: 7,
  },
  purchaseButton: {
    minHeight: 54,
    borderRadius: 27,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 20,
  },
  purchaseText: {
    color: "#FFFFFF",
    fontSize: 16,
    fontWeight: "800",
    textAlign: "center",
  },
  linkRow: {
    minHeight: 38,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-around",
    paddingHorizontal: 4,
  },
  link: {
    fontSize: 10,
    fontWeight: "600",
    textDecorationLine: "underline",
  },
});
