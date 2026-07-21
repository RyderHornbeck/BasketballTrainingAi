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
  calculateDiscountPercent,
  formatCurrency,
  formatSubscriptionDate,
  normalizeSubscriptionPackage,
  NormalizedSubscriptionPackage,
  parseIso8601Period,
  SubscriptionDuration,
} from "@/lib/subscriptionFormatting";
import { Redirect, router, useLocalSearchParams } from "expo-router";
import { LinearGradient } from "expo-linear-gradient";
import { StatusBar } from "expo-status-bar";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
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
type PaywallStatus = "loading" | "ready" | "purchasing" | "restoring" | "error";

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
  const requestedContinuation = Array.isArray(next) ? next[0] : next;
  const continuation =
    requestedContinuation === "finish-setup" ? "finish-setup" : "generating";
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
  const requestLockRef = useRef(false);
  const impressionIdsRef = useRef(new Set<string>());
  const navigationTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hasContinuedRef = useRef(false);

  const palette = mode === "deal" ? DEAL_COLORS : DEFAULT_COLORS;

  const continueToApp = useCallback((event = "purchase_completed") => {
    if (hasContinuedRef.current) return;
    hasContinuedRef.current = true;
    if (event !== "entitlement_active") completionHaptic();
    logPaywallEvent(event, { continuation });
    // StoreKit's purchase sheet dismisses outside React Native. Mounting the
    // workout tree during that native dismissal can race the navigation and
    // Worklets/Reanimated native modules. Let the dismissal finish first.
    navigationTimeoutRef.current = setTimeout(() => {
      navigationTimeoutRef.current = null;
      // Keep the paywall route mounted underneath the protected tabs for this
      // session. Native-stack replace tears down and snapshots the Fabric tree
      // at the same time the workout tree mounts, which has caused release-only
      // iOS crashes after StoreKit dismissal.
      router.push(
        continuation === "finish-setup"
          ? "/finish-setup"
          : "/(tabs)/days"
      );
    }, 700);
  }, [continuation]);

  useEffect(
    () => () => {
      if (navigationTimeoutRef.current) {
        clearTimeout(navigationTimeoutRef.current);
        navigationTimeoutRef.current = null;
      }
    },
    []
  );

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

  const plans = useMemo<NormalizedSubscriptionPackage[]>(() => {
    if (!offering) return [];
    return packagesForOffering(offering).map(({ item, duration }) =>
      normalizeSubscriptionPackage(item, duration, eligibility[item.product.identifier])
    );
  }, [eligibility, offering]);

  const selectedPlan =
    plans.find((plan) => plan.duration === selectedDuration) ?? plans[0] ?? null;

  const defaultPrices = useMemo(() => {
    const prices = new Map<SubscriptionDuration, number>();
    if (!defaultOffering) return prices;
    for (const entry of packagesForOffering(defaultOffering)) {
      prices.set(entry.duration, entry.item.product.price);
    }
    return prices;
  }, [defaultOffering]);

  const selectedDealDiscount =
    mode === "deal" && selectedPlan
      ? calculateDiscountPercent(
          defaultPrices.get(selectedPlan.duration),
          selectedPlan.regularPrice
        )
      : null;
  const dealRate =
    mode === "deal" && selectedPlan
      ? selectedPlan.duration === "annual"
        ? {
            price:
              selectedPlan.localizedMonthlyEquivalent ??
              formatCurrency(
                selectedPlan.regularPrice / 12,
                selectedPlan.currencyCode,
                `${(selectedPlan.regularPrice / 12).toFixed(2)} ${
                  selectedPlan.currencyCode
                }`
              ),
            period: "month",
          }
        : {
            price: formatCurrency(
              (selectedPlan.regularPrice * 12) / 52,
              selectedPlan.currencyCode,
              `${((selectedPlan.regularPrice * 12) / 52).toFixed(2)} ${
                selectedPlan.currencyCode
              }`
            ),
            period: "week",
          }
      : null;
  const dealBillingDetail =
    mode === "deal" && selectedPlan && dealRate
      ? `${selectedPlan.localizedRegularPrice} per ${
          selectedPlan.duration === "annual" ? "year" : "month"
        } (${dealRate.price}/${dealRate.period})`
      : null;

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

  const isWorking = status === "purchasing" || status === "restoring";
  const trialDate =
    selectedPlan?.trialEndDate && formatSubscriptionDate(selectedPlan.trialEndDate);
  const renewalDate =
    selectedPlan?.renewalDate && formatSubscriptionDate(selectedPlan.renewalDate);
  const timeline = selectedPlan?.hasEligibleFreeTrial
    ? [
        {
          title: "Today",
          description: "Unlock your personalized plan and a live AI coach.",
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
            description: "Unlock your personalized plan and a live AI coach.",
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
  const cta = mode === "default" && selectedPlan?.hasEligibleFreeTrial
    ? "Try Now For $0.00"
    : selectedPlan?.hasEligibleFreeTrial && selectedPlan.trialLabel
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
        <View style={styles.safeArea}>
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
            <Text style={[styles.title, { color: palette.text }]}>
              {mode === "deal"
                ? "Special Offer"
                : "Your smarter training starts now"}
            </Text>
            <Text style={[styles.subtitle, { color: palette.muted }]}>
              {mode === "deal"
                ? "Adaptive workouts, easier tracking, and a live coach that keeps every session moving at a special price."
                : "Adaptive workouts, easier tracking, and a live coach that keeps every session moving."}
            </Text>

            {mode === "deal" ? (
              <LinearGradient
                accessible
                accessibilityLabel={`${selectedDealDiscount ?? "Special"} percent off. ${
                  dealRate ? `${dealRate.price} per ${dealRate.period}.` : ""
                } ${dealBillingDetail ?? ""}`}
                colors={["#4B1FA3", "#7048E8", "#9B6DFF"]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={styles.dealSummary}
              >
                <Text style={[styles.sparkle, styles.sparkleTopLeft]}>✦</Text>
                <Text style={[styles.sparkle, styles.sparkleTopRight]}>✧</Text>
                <Text style={[styles.sparkle, styles.sparkleBottomLeft]}>✧</Text>
                <Text style={[styles.sparkle, styles.sparkleBottomRight]}>✦</Text>
                <Text style={styles.dealDiscount}>
                  {selectedDealDiscount
                    ? `${selectedDealDiscount}% Off`
                    : "Special Pricing"}
                </Text>
                {dealRate ? (
                  <View style={styles.dealRateBubble}>
                    <Text style={styles.dealRate}>
                      {dealRate.price}/{dealRate.period === "month" ? "mo" : "wk"}
                    </Text>
                  </View>
                ) : null}
                {dealBillingDetail ? (
                  <Text style={styles.dealBillingDetail}>{dealBillingDetail}</Text>
                ) : null}
              </LinearGradient>
            ) : (
              timeline.map((item, index) => (
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
              ))
            )}

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
            <View accessibilityRole="radiogroup" style={styles.plans}>
              {plans.map((plan) => (
                <View key={plan.package.identifier} style={styles.planOption}>
                  <PlanCard
                    plan={plan}
                    selected={plan.duration === selectedPlan?.duration}
                    onPress={() => {
                      selectionHaptic();
                      setSelectedDuration(plan.duration);
                    }}
                    accentColor={palette.accent}
                    textColor={palette.text}
                    backgroundColor={palette.card}
                    disabled={isWorking}
                  />
                </View>
              ))}
            </View>
            {message ? (
              <Text accessibilityRole="alert" style={styles.operationMessage}>
                {message}
              </Text>
            ) : null}
            <Text style={[styles.cancelText, { color: palette.muted }]}></Text>
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
            <Text style={[styles.billingText, { color: palette.muted }]}>
              
            </Text>
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
        </View>
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
  dealSummary: {
    minHeight: 190,
    borderRadius: 28,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
    paddingHorizontal: 22,
    paddingVertical: 24,
    shadowColor: "#4B1FA3",
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.3,
    shadowRadius: 18,
    elevation: 8,
  },
  dealDiscount: {
    color: "#FFFFFF",
    fontSize: 26,
    lineHeight: 34,
    fontWeight: "800",
    textAlign: "center",
  },
  dealRateBubble: {
    minWidth: 160,
    marginTop: 14,
    borderRadius: 999,
    backgroundColor: "#FFFFFF",
    paddingHorizontal: 22,
    paddingVertical: 12,
  },
  dealRate: {
    color: "#111111",
    fontSize: 22,
    lineHeight: 28,
    fontWeight: "800",
    textAlign: "center",
  },
  dealBillingDetail: {
    marginTop: 10,
    color: "#DED7EE",
    fontSize: 11,
    lineHeight: 16,
    fontWeight: "600",
    textAlign: "center",
  },
  sparkle: {
    position: "absolute",
    color: "rgba(255,255,255,0.78)",
    fontSize: 24,
    fontWeight: "700",
  },
  sparkleTopLeft: {
    top: 16,
    left: 19,
  },
  sparkleTopRight: {
    top: 24,
    right: 22,
    fontSize: 19,
  },
  sparkleBottomLeft: {
    bottom: 20,
    left: 30,
    fontSize: 17,
  },
  sparkleBottomRight: {
    right: 19,
    bottom: 15,
  },
  plans: {
    gap: 11,
  },
  planOption: {
    width: "100%",
  },
  operationMessage: {
    marginTop: 8,
    color: "#B42318",
    fontSize: 12,
    lineHeight: 18,
    fontWeight: "600",
    textAlign: "center",
  },
  cancelText: {
    marginVertical: 8,
    fontSize: 12,
    fontWeight: "700",
    textAlign: "center",
  },
  billingText: {
    marginTop: 5,
    fontSize: 9,
    lineHeight: 14,
    textAlign: "center",
  },
  bottomBar: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 22,
    paddingTop: 12,
    paddingBottom: 5,
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
