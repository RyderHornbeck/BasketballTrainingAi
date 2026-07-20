import { useAuth } from "@/hooks/useAuth";
import {
  addRevenueCatCustomerInfoListener,
  DEFAULT_OFFERING_ID,
  DEAL_OFFERING_ID,
  getRevenueCatCustomerInfo,
  getRevenueCatOfferings,
  hasPremiumEntitlement,
  identifyRevenueCatUser,
  initializeRevenueCat,
  isRevenueCatSupported,
  logOutRevenueCatUser,
  purchaseRevenueCatPackage,
  restoreRevenueCatPurchases,
} from "@/lib/revenueCat";
import {
  CustomerInfo,
  PurchasesOffering,
  PurchasesOfferings,
  PurchasesPackage,
} from "react-native-purchases";
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { AppState } from "react-native";

interface SubscriptionContextValue {
  customerInfo: CustomerInfo | null;
  hasPremium: boolean;
  isLoadingSubscription: boolean;
  subscriptionError: string | null;
  currentOffering: PurchasesOffering | null;
  dealOffering: PurchasesOffering | null;
  refreshCustomerInfo: () => Promise<CustomerInfo>;
  refreshOfferings: () => Promise<PurchasesOfferings>;
  restorePurchases: () => Promise<CustomerInfo>;
  purchasePackage: (selectedPackage: PurchasesPackage) => Promise<CustomerInfo>;
  acceptCustomerInfo: (customerInfo: CustomerInfo) => void;
  retrySubscription: () => Promise<void>;
}

const SubscriptionContext = createContext<SubscriptionContextValue | undefined>(undefined);

export function SubscriptionProvider({ children }: { children: React.ReactNode }) {
  const { user, loading: authLoading } = useAuth();
  const supported = isRevenueCatSupported();
  const [customerInfo, setCustomerInfo] = useState<CustomerInfo | null>(null);
  const [offerings, setOfferings] = useState<PurchasesOfferings | null>(null);
  const [isLoadingSubscription, setIsLoadingSubscription] = useState(supported);
  const [subscriptionError, setSubscriptionError] = useState<string | null>(null);
  const identityGenerationRef = useRef(0);
  const activeUserIdRef = useRef<string | null>(null);

  const acceptCustomerInfo = useCallback((nextCustomerInfo: CustomerInfo) => {
    setCustomerInfo(nextCustomerInfo);
    setSubscriptionError(null);
  }, []);

  const refreshOfferings = useCallback(async () => {
    const nextOfferings = await getRevenueCatOfferings();
    setOfferings(nextOfferings);
    return nextOfferings;
  }, []);

  const refreshCustomerInfo = useCallback(async () => {
    const nextCustomerInfo = await getRevenueCatCustomerInfo();
    acceptCustomerInfo(nextCustomerInfo);
    return nextCustomerInfo;
  }, [acceptCustomerInfo]);

  const synchronize = useCallback(async () => {
    if (!supported || authLoading) return;
    const generation = ++identityGenerationRef.current;

    if (!user?.id) {
      activeUserIdRef.current = null;
      setCustomerInfo(null);
      setOfferings(null);
      setSubscriptionError(null);
      setIsLoadingSubscription(false);
      void logOutRevenueCatUser().catch((error) => {
        if (__DEV__) console.warn("RevenueCat logout failed:", error);
      });
      return;
    }

    setIsLoadingSubscription(true);
    setSubscriptionError(null);
    try {
      const nextCustomerInfo = await identifyRevenueCatUser(user.id);
      if (generation !== identityGenerationRef.current) return;
      activeUserIdRef.current = user.id;
      setCustomerInfo(nextCustomerInfo);

      if (!hasPremiumEntitlement(nextCustomerInfo)) {
        const nextOfferings = await getRevenueCatOfferings();
        if (generation !== identityGenerationRef.current) return;
        setOfferings(nextOfferings);
      }
    } catch (error) {
      if (generation !== identityGenerationRef.current) return;
      setSubscriptionError(
        error instanceof Error ? error.message : "Unable to check your subscription."
      );
    } finally {
      if (generation === identityGenerationRef.current) setIsLoadingSubscription(false);
    }
  }, [authLoading, supported, user]);

  const retrySubscription = useCallback(async () => {
    await synchronize();
  }, [synchronize]);

  const purchasePackage = useCallback(
    async (selectedPackage: PurchasesPackage) => {
      const nextCustomerInfo = await purchaseRevenueCatPackage(selectedPackage);
      acceptCustomerInfo(nextCustomerInfo);
      return nextCustomerInfo;
    },
    [acceptCustomerInfo]
  );

  const restorePurchases = useCallback(async () => {
    const nextCustomerInfo = await restoreRevenueCatPurchases();
    acceptCustomerInfo(nextCustomerInfo);
    return nextCustomerInfo;
  }, [acceptCustomerInfo]);

  useEffect(() => {
    if (!supported) return;
    void initializeRevenueCat().catch((error) => {
      setSubscriptionError(
        error instanceof Error ? error.message : "Subscriptions are temporarily unavailable."
      );
      setIsLoadingSubscription(false);
    });
  }, [supported]);

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      void synchronize();
    });
    return () => cancelAnimationFrame(frame);
  }, [synchronize]);

  useEffect(() => {
    if (!supported) return;
    let removeListener: (() => void) | undefined;
    void initializeRevenueCat()
      .then(() => {
        removeListener = addRevenueCatCustomerInfoListener((nextCustomerInfo) => {
          if (!activeUserIdRef.current) return;
          acceptCustomerInfo(nextCustomerInfo);
        });
      })
      .catch(() => {});
    return () => removeListener?.();
  }, [acceptCustomerInfo, supported]);

  useEffect(() => {
    if (!supported) return;
    const subscription = AppState.addEventListener("change", (state) => {
      if (state !== "active" || !activeUserIdRef.current) return;
      void refreshCustomerInfo().catch(() => {});
    });
    return () => subscription.remove();
  }, [refreshCustomerInfo, supported]);

  const currentOffering =
    offerings?.current?.identifier === DEFAULT_OFFERING_ID
      ? offerings.current
      : offerings?.all[DEFAULT_OFFERING_ID] ?? null;
  const dealOffering = offerings?.all[DEAL_OFFERING_ID] ?? null;

  const value = useMemo<SubscriptionContextValue>(
    () => ({
      customerInfo,
      hasPremium: !supported || hasPremiumEntitlement(customerInfo),
      isLoadingSubscription,
      subscriptionError,
      currentOffering,
      dealOffering,
      refreshCustomerInfo,
      refreshOfferings,
      restorePurchases,
      purchasePackage,
      acceptCustomerInfo,
      retrySubscription,
    }),
    [
      acceptCustomerInfo,
      currentOffering,
      customerInfo,
      dealOffering,
      isLoadingSubscription,
      purchasePackage,
      refreshCustomerInfo,
      refreshOfferings,
      restorePurchases,
      retrySubscription,
      subscriptionError,
      supported,
    ]
  );

  return (
    <SubscriptionContext.Provider value={value}>{children}</SubscriptionContext.Provider>
  );
}

export function useSubscription(): SubscriptionContextValue {
  const context = useContext(SubscriptionContext);
  if (!context) throw new Error("useSubscription must be used within SubscriptionProvider");
  return context;
}
