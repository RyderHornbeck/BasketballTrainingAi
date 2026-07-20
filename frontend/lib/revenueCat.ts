import { Platform } from "react-native";
import Purchases, {
  CustomerInfo,
  INTRO_ELIGIBILITY_STATUS,
  IntroEligibility,
  LOG_LEVEL,
  PURCHASES_ERROR_CODE,
  PurchasesError,
  PurchasesOfferings,
  PurchasesPackage,
} from "react-native-purchases";

export const PREMIUM_ENTITLEMENT_ID = "premium";
export const DEFAULT_OFFERING_ID = "default";
export const DEAL_OFFERING_ID = "deal";

const iosApiKey = process.env.EXPO_PUBLIC_REVENUECAT_IOS_API_KEY?.trim();
let configurationPromise: Promise<void> | null = null;
let identityQueue: Promise<unknown> = Promise.resolve();

export class RevenueCatConfigurationError extends Error {}

export function isRevenueCatSupported(): boolean {
  return Platform.OS === "ios";
}

export function hasPremiumEntitlement(customerInfo: CustomerInfo | null | undefined): boolean {
  return Boolean(customerInfo?.entitlements.active[PREMIUM_ENTITLEMENT_ID]);
}

export function initializeRevenueCat(): Promise<void> {
  if (!isRevenueCatSupported()) return Promise.resolve();
  if (configurationPromise) return configurationPromise;

  configurationPromise = (async () => {
    if (!iosApiKey || !iosApiKey.startsWith("appl_")) {
      const detail = __DEV__
        ? "EXPO_PUBLIC_REVENUECAT_IOS_API_KEY must contain the public appl_ RevenueCat SDK key."
        : "Subscriptions are temporarily unavailable.";
      throw new RevenueCatConfigurationError(detail);
    }

    await Purchases.setLogLevel(__DEV__ ? LOG_LEVEL.DEBUG : LOG_LEVEL.WARN);
    if (!(await Purchases.isConfigured())) {
      Purchases.configure({ apiKey: iosApiKey });
    }
  })().catch((error) => {
    configurationPromise = null;
    throw error;
  });

  return configurationPromise;
}

export async function identifyRevenueCatUser(userId: string): Promise<CustomerInfo> {
  const request = identityQueue.catch(() => undefined).then(async () => {
    await initializeRevenueCat();
    const currentUserId = await Purchases.getAppUserID();
    if (currentUserId === userId) return Purchases.getCustomerInfo();
    const result = await Purchases.logIn(userId);
    return result.customerInfo;
  });
  identityQueue = request;
  return request;
}

export async function logOutRevenueCatUser(): Promise<CustomerInfo | null> {
  if (!isRevenueCatSupported() || !(await Purchases.isConfigured())) return null;
  const request = identityQueue.catch(() => undefined).then(async () => {
    if (await Purchases.isAnonymous()) return Purchases.getCustomerInfo();
    return Purchases.logOut();
  });
  identityQueue = request;
  return request;
}

export async function getRevenueCatCustomerInfo(): Promise<CustomerInfo> {
  await initializeRevenueCat();
  return Purchases.getCustomerInfo();
}

export async function getRevenueCatOfferings(): Promise<PurchasesOfferings> {
  await initializeRevenueCat();
  return Purchases.getOfferings();
}

export async function getIntroEligibility(
  packages: PurchasesPackage[]
): Promise<Record<string, IntroEligibility>> {
  await initializeRevenueCat();
  const productIds = [...new Set(packages.map((item) => item.product.identifier))];
  if (productIds.length === 0) return {};
  return Purchases.checkTrialOrIntroductoryPriceEligibility(productIds);
}

export async function purchaseRevenueCatPackage(
  selectedPackage: PurchasesPackage
): Promise<CustomerInfo> {
  const result = await Purchases.purchasePackage(selectedPackage);
  return result.customerInfo;
}

export async function restoreRevenueCatPurchases(): Promise<CustomerInfo> {
  await initializeRevenueCat();
  return Purchases.restorePurchases();
}

export function addRevenueCatCustomerInfoListener(
  listener: (customerInfo: CustomerInfo) => void
): () => void {
  Purchases.addCustomerInfoUpdateListener(listener);
  return () => {
    Purchases.removeCustomerInfoUpdateListener(listener);
  };
}

export async function trackRevenueCatPaywallImpression(
  offeringId: string,
  offering: Parameters<typeof Purchases.trackCustomPaywallImpression>[0] extends
    | { offering?: infer T }
    | undefined
    ? T
    : never
): Promise<void> {
  await initializeRevenueCat();
  await Purchases.trackCustomPaywallImpression({
    paywallId: `court-coach-${offeringId}`,
    offering,
  });
}

export function isPurchasesError(error: unknown): error is PurchasesError {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof (error as { code?: unknown }).code === "string"
  );
}

export function isPurchaseCancelled(error: unknown): boolean {
  return (
    isPurchasesError(error) &&
    error.code === PURCHASES_ERROR_CODE.PURCHASE_CANCELLED_ERROR
  );
}

export function revenueCatErrorMessage(error: unknown): string {
  if (error instanceof RevenueCatConfigurationError) return error.message;
  if (!isPurchasesError(error)) {
    return error instanceof Error ? error.message : "Something went wrong. Please try again.";
  }

  switch (error.code) {
    case PURCHASES_ERROR_CODE.PAYMENT_PENDING_ERROR:
      return "Your purchase is pending approval. Access will unlock when Apple confirms it.";
    case PURCHASES_ERROR_CODE.PURCHASE_NOT_ALLOWED_ERROR:
      return "Purchases are not allowed on this device.";
    case PURCHASES_ERROR_CODE.PRODUCT_NOT_AVAILABLE_FOR_PURCHASE_ERROR:
      return "This subscription is currently unavailable. Please try again later.";
    case PURCHASES_ERROR_CODE.PRODUCT_ALREADY_PURCHASED_ERROR:
      return "This subscription may already belong to your Apple account. Try restoring purchases.";
    case PURCHASES_ERROR_CODE.NETWORK_ERROR:
    case PURCHASES_ERROR_CODE.OFFLINE_CONNECTION_ERROR:
    case PURCHASES_ERROR_CODE.PRODUCT_REQUEST_TIMED_OUT_ERROR:
      return "Check your internet connection and try again.";
    case PURCHASES_ERROR_CODE.OPERATION_ALREADY_IN_PROGRESS_ERROR:
      return "A purchase is already in progress.";
    case PURCHASES_ERROR_CODE.CONFIGURATION_ERROR:
    case PURCHASES_ERROR_CODE.INVALID_CREDENTIALS_ERROR:
      return "Subscriptions are temporarily unavailable. Please try again later.";
    default:
      return "Apple could not complete the purchase. Please try again.";
  }
}

export function logRevenueCatError(
  label: string,
  error: unknown,
  context?: {
    offeringId?: string | null;
    packageId?: string | null;
    productId?: string | null;
  }
): void {
  if (!__DEV__) return;
  console.warn(label, {
    ...context,
    code: isPurchasesError(error) ? error.code : "unknown",
    message: error instanceof Error ? error.message : String(error),
  });
}

export { INTRO_ELIGIBILITY_STATUS, PURCHASES_ERROR_CODE };
