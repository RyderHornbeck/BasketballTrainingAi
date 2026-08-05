export const AI_DATA_CONSENT_VERSION = "2026-08-05";
export const AI_DATA_CONSENT_REQUIRED_CODE = "ai_data_consent_required";

export async function hasCurrentAIDataConsent(
  supabase: any,
  userId: string,
): Promise<boolean> {
  const { data, error } = await supabase
    .from("profiles")
    .select(
      "ai_data_processing_allowed, ai_data_processing_consent_version",
    )
    .eq("id", userId)
    .maybeSingle();
  if (error) {
    throw new Error(error.message || "Unable to verify AI data consent.");
  }
  return data?.ai_data_processing_allowed === true &&
    data.ai_data_processing_consent_version === AI_DATA_CONSENT_VERSION;
}

export function aiDataConsentRequiredBody() {
  return {
    error:
      "Allow AI data processing in Settings > Privacy before using this feature.",
    code: AI_DATA_CONSENT_REQUIRED_CODE,
  };
}
