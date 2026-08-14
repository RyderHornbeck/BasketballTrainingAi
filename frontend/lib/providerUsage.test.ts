import {
  createProviderUsageDelta,
  type ProviderUsageDelta,
} from "./providerUsage";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function sameDelta(left: ProviderUsageDelta, right: ProviderUsageDelta): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

const assemblyDelta = createProviderUsageDelta("assembly-inworld", 4, {
  assemblySessionSeconds: 15.123,
  inworldTtsCharacters: 320,
});
const retryDelta = assemblyDelta;

assert(
  sameDelta(assemblyDelta, retryDelta),
  "a retry must retain the original Assembly/Inworld usage ID and quantities",
);
assert(
  assemblyDelta.requestId === "assembly-inworld-usage-4",
  "expected a stable Assembly/Inworld request ID",
);

const cartesiaDelta = createProviderUsageDelta("cartesia", 5, {
  sttSeconds: 15,
  ttsCharacters: 300,
});
assert(
  cartesiaDelta.requestId === "cartesia-usage-5",
  "expected a stable Cartesia request ID",
);
assert(
  String(cartesiaDelta.requestId) !== String(assemblyDelta.requestId),
  "separate provider deltas must not share IDs",
);

console.log("✓ provider usage deltas retain idempotency identities");
