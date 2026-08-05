import {
  AI_DATA_CONSENT_VERSION,
  aiDataConsentRequiredBody,
  hasCurrentAIDataConsent,
} from "./aiDataConsent.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function consentClient(
  allowed: boolean,
  version: string | null,
) {
  return {
    from() {
      return {
        select() {
          return {
            eq() {
              return {
                maybeSingle: async () => ({
                  data: {
                    ai_data_processing_allowed: allowed,
                    ai_data_processing_consent_version: version,
                  },
                  error: null,
                }),
              };
            },
          };
        },
      };
    },
  };
}

Deno.test("AI provider access requires an affirmative current-version consent", async () => {
  assert(
    await hasCurrentAIDataConsent(
      consentClient(true, AI_DATA_CONSENT_VERSION),
      "user",
    ),
    "current affirmative consent should allow AI processing",
  );
  assert(
    !(await hasCurrentAIDataConsent(
      consentClient(false, AI_DATA_CONSENT_VERSION),
      "user",
    )),
    "a denied choice must block AI processing",
  );
  assert(
    !(await hasCurrentAIDataConsent(
      consentClient(true, "older-disclosure"),
      "user",
    )),
    "stale disclosure consent must not authorize new processing",
  );
  assert(
    aiDataConsentRequiredBody().code === "ai_data_consent_required",
    "blocked endpoints should return a stable client code",
  );
});
