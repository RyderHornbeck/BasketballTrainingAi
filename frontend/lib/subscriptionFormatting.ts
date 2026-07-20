import {
  INTRO_ELIGIBILITY_STATUS,
  IntroEligibility,
  PurchasesPackage,
} from "react-native-purchases";

export type SubscriptionDuration = "annual" | "monthly";
export type PeriodUnit = "day" | "week" | "month" | "year";

export interface CalendarPeriod {
  count: number;
  unit: PeriodUnit;
}

export interface NormalizedSubscriptionPackage {
  package: PurchasesPackage;
  duration: SubscriptionDuration;
  hasIntroOffer: boolean;
  isFreeTrial: boolean;
  isEligibleForIntro: boolean;
  hasEligibleFreeTrial: boolean;
  introDurationCount: number | null;
  introDurationUnit: PeriodUnit | null;
  trialLabel: string | null;
  trialDurationText: string | null;
  trialEndDate: Date | null;
  regularPrice: number;
  localizedRegularPrice: string;
  currencyCode: string;
  billingPeriod: CalendarPeriod | null;
  periodLabel: string;
  renewalDate: Date | null;
  monthlyEquivalent: number | null;
  localizedMonthlyEquivalent: string | null;
}

function normalizePeriodUnit(value: string | null | undefined): PeriodUnit | null {
  switch (value?.toUpperCase()) {
    case "DAY":
      return "day";
    case "WEEK":
      return "week";
    case "MONTH":
      return "month";
    case "YEAR":
      return "year";
    default:
      return null;
  }
}

export function parseIso8601Period(value: string | null | undefined): CalendarPeriod | null {
  if (!value) return null;
  const match = /^P(?:(\d+)Y)?(?:(\d+)M)?(?:(\d+)W)?(?:(\d+)D)?$/i.exec(value);
  if (!match) return null;
  const candidates: [string | undefined, PeriodUnit][] = [
    [match[1], "year"],
    [match[2], "month"],
    [match[3], "week"],
    [match[4], "day"],
  ];
  for (const [rawCount, unit] of candidates) {
    if (!rawCount) continue;
    const count = Number.parseInt(rawCount, 10);
    if (Number.isFinite(count) && count > 0) return { count, unit };
  }
  return null;
}

export function addCalendarPeriod(date: Date, period: CalendarPeriod): Date {
  const result = new Date(date);
  switch (period.unit) {
    case "day":
      result.setDate(result.getDate() + period.count);
      break;
    case "week":
      result.setDate(result.getDate() + period.count * 7);
      break;
    case "month":
      {
        const desiredDay = result.getDate();
        result.setDate(1);
        result.setMonth(result.getMonth() + period.count);
        const lastDayOfTargetMonth = new Date(
          result.getFullYear(),
          result.getMonth() + 1,
          0
        ).getDate();
        result.setDate(Math.min(desiredDay, lastDayOfTargetMonth));
      }
      break;
    case "year":
      {
        const desiredMonth = result.getMonth();
        const desiredDay = result.getDate();
        result.setDate(1);
        result.setFullYear(result.getFullYear() + period.count);
        result.setMonth(desiredMonth);
        const lastDayOfTargetMonth = new Date(
          result.getFullYear(),
          desiredMonth + 1,
          0
        ).getDate();
        result.setDate(Math.min(desiredDay, lastDayOfTargetMonth));
      }
      break;
  }
  return result;
}

export function pluralizedPeriod(period: CalendarPeriod): string {
  return `${period.count} ${period.unit}${period.count === 1 ? "" : "s"}`;
}

function titlePeriod(period: CalendarPeriod): string {
  const unit = `${period.unit.charAt(0).toUpperCase()}${period.unit.slice(1)}`;
  return `${period.count}-${unit}${period.count === 1 ? "" : "s"}`;
}

export function formatCurrency(
  amount: number,
  currencyCode: string,
  fallback: string
): string {
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: currencyCode,
      currencyDisplay: "narrowSymbol",
    }).format(amount);
  } catch {
    return fallback;
  }
}

export function formatSubscriptionDate(date: Date): string {
  return new Intl.DateTimeFormat(undefined, {
    month: "long",
    day: "numeric",
  }).format(date);
}

export function normalizeSubscriptionPackage(
  selectedPackage: PurchasesPackage,
  duration: SubscriptionDuration,
  eligibility: IntroEligibility | undefined,
  now = new Date()
): NormalizedSubscriptionPackage {
  const product = selectedPackage.product;
  const intro = product.introPrice;
  const introUnit = normalizePeriodUnit(intro?.periodUnit);
  const introCount =
    intro && introUnit
      ? Math.max(1, intro.periodNumberOfUnits) * Math.max(1, intro.cycles)
      : null;
  const introPeriod =
    introCount && introUnit ? { count: introCount, unit: introUnit } : null;
  const isEligibleForIntro =
    eligibility?.status === INTRO_ELIGIBILITY_STATUS.INTRO_ELIGIBILITY_STATUS_ELIGIBLE;
  const isFreeTrial = Boolean(intro && Math.abs(intro.price) < Number.EPSILON);
  const hasEligibleFreeTrial = Boolean(introPeriod && isFreeTrial && isEligibleForIntro);
  const billingPeriod = parseIso8601Period(product.subscriptionPeriod);
  const trialEndDate =
    hasEligibleFreeTrial && introPeriod ? addCalendarPeriod(now, introPeriod) : null;
  const renewalDate = trialEndDate ?? (billingPeriod ? addCalendarPeriod(now, billingPeriod) : null);
  const periodLabel = billingPeriod
    ? billingPeriod.count === 1
      ? billingPeriod.unit
      : pluralizedPeriod(billingPeriod)
    : duration === "annual"
      ? "year"
      : "month";
  const monthlyEquivalent = duration === "annual" ? product.price / 12 : null;

  return {
    package: selectedPackage,
    duration,
    hasIntroOffer: Boolean(intro),
    isFreeTrial,
    isEligibleForIntro,
    hasEligibleFreeTrial,
    introDurationCount: introCount,
    introDurationUnit: introUnit,
    trialLabel:
      hasEligibleFreeTrial && introPeriod ? `${titlePeriod(introPeriod)} Free Trial` : null,
    trialDurationText:
      hasEligibleFreeTrial && introPeriod ? pluralizedPeriod(introPeriod) : null,
    trialEndDate,
    regularPrice: product.price,
    localizedRegularPrice: product.priceString,
    currencyCode: product.currencyCode,
    billingPeriod,
    periodLabel,
    renewalDate,
    monthlyEquivalent,
    localizedMonthlyEquivalent:
      monthlyEquivalent == null
        ? null
        : product.pricePerMonthString ??
          formatCurrency(monthlyEquivalent, product.currencyCode, product.priceString),
  };
}

export function calculateDiscountPercent(
  standardPrice: number | null | undefined,
  dealPrice: number | null | undefined
): number | null {
  if (
    typeof standardPrice !== "number" ||
    typeof dealPrice !== "number" ||
    !Number.isFinite(standardPrice) ||
    !Number.isFinite(dealPrice) ||
    standardPrice <= 0 ||
    dealPrice < 0
  ) {
    return null;
  }
  const percentage = Math.round((1 - dealPrice / standardPrice) * 100);
  return percentage > 0 ? Math.min(100, percentage) : null;
}

export function calculateAnnualSavingsPercent(
  annualPrice: number,
  monthlyPrice: number | null | undefined
): number | null {
  if (
    typeof monthlyPrice !== "number" ||
    !Number.isFinite(monthlyPrice) ||
    monthlyPrice <= 0
  ) {
    return null;
  }
  return calculateDiscountPercent(monthlyPrice * 12, annualPrice);
}
