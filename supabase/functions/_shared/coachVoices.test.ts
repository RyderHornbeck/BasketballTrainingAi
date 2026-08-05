import {
  COACH_VOICE_PERSONA_IDS,
  getCoachVoicePersonas,
  isCoachVoicePersonaId,
  resolveCoachVoicePersona,
} from "./coachVoices.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

Deno.test("coach voice personas expose four stable server mappings", () => {
  const personas = getCoachVoicePersonas(() => undefined);
  assert(personas.length === 4, "expected exactly four personas");
  assert(
    personas.map((persona) => persona.id).join(",") ===
      COACH_VOICE_PERSONA_IDS.join(","),
    "expected stable persona ordering",
  );
  assert(
    new Set(personas.map((persona) => persona.provider_voice_id)).size === 4,
    "expected distinct provider voices",
  );
  assert(
    personas.map((persona) => persona.provider_voice_id).join(",") === [
      "a5136bf9-224c-4d76-b823-52bd5efcffcc",
      "228fca29-3a0a-435c-8728-5cb483251068",
      "6ccbfb76-1fc6-48f7-b71d-91ac6298247b",
      "f786b574-daa5-4673-aa0c-cbe3e8534c02",
    ].join(","),
    "expected the verified American voice roster",
  );
  assert(
    personas.every((persona) =>
      persona.provider === "cartesia" &&
      persona.model_id === "sonic-3.5" &&
      persona.language === "en"
    ),
    "expected bounded provider configuration",
  );
});

Deno.test("coach voice mapping accepts only valid UUID environment overrides", () => {
  const override = "47c38ca4-5f35-497b-b1a3-415245fb35e1";
  const valid = resolveCoachVoicePersona(
    "tyler",
    (key) => key === "CARTESIA_VOICE_TYLER" ? override : undefined,
  );
  assert(
    valid.provider_voice_id === override,
    "expected valid server override",
  );

  const invalid = resolveCoachVoicePersona(
    "tyler",
    () => "../../client-controlled",
  );
  assert(
    invalid.provider_voice_id !== "../../client-controlled",
    "expected safe fallback",
  );
});

Deno.test("unknown coach voice values cannot select provider voice IDs", () => {
  assert(isCoachVoicePersonaId("maya"), "expected known persona");
  assert(
    !isCoachVoicePersonaId("provider-voice-id"),
    "expected unknown rejection",
  );
  assert(
    resolveCoachVoicePersona("provider-voice-id", () => undefined).id ===
      "tyler",
    "expected stable default",
  );
});
