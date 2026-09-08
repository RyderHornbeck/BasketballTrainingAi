// @ts-nocheck -- Executed by Node through tsx, outside the React Native runtime.
import assert from "node:assert/strict";
import test from "node:test";
import { selectVideoShotReply, videoShotKind } from "./videoShotFeedback";

test("classifies floater, layup, and shooting feedback", () => {
  assert.equal(videoShotKind("finishing", "One-dribble floater"), "floater");
  assert.equal(videoShotKind("finishing", "Reverse Layup"), "layup");
  assert.equal(videoShotKind("shooting", "Corner Three"), "shooting");
});

test("prioritizes exact make streak milestones", () => {
  for (const streak of [3, 5, 10]) {
    assert.equal(selectVideoShotReply({
      result: "make",
      kind: "shooting",
      makes: streak,
      attempts: streak,
      makeStreak: streak,
      random: () => 0.99,
    }), `Keep going, you're ${streak} in a row.`);
  }
});

test("uses score twenty percent path without shots-left text", () => {
  const reply = selectVideoShotReply({
    result: "miss",
    kind: "layup",
    makes: 2,
    attempts: 4,
    makeStreak: 0,
    random: () => 0.8,
  });
  assert.equal(reply, "You're 2 for 4.");
  assert.doesNotMatch(reply, /shots? left/i);
});

test("uses shot-type feedback below score threshold", () => {
  assert.equal(selectVideoShotReply({
    result: "make",
    kind: "floater",
    makes: 1,
    attempts: 1,
    makeStreak: 1,
    random: () => 0,
  }), "Nice floater.");
  assert.equal(selectVideoShotReply({
    result: "miss",
    kind: "shooting",
    makes: 0,
    attempts: 1,
    makeStreak: 0,
    random: () => 0,
  }), "Bend your knees and get your legs into the shot.");
});
