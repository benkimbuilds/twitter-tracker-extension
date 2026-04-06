const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

function loadSitesModule() {
  const source = fs.readFileSync(path.join(__dirname, "..", "sites.js"), "utf8");
  const context = {
    URL,
    console,
    Date
  };

  vm.createContext(context);
  vm.runInContext(
    `${source}
this.__sites = {
  createCustomSite,
  normalizeBlockedSites,
  normalizeHistoryExcludedSites,
  normalizeTimedBlocks,
  normalizeBlockTimerMinutes,
  getSiteBlockState
};`,
    context
  );

  return context.__sites;
}

const {
  createCustomSite,
  normalizeBlockedSites,
  normalizeHistoryExcludedSites,
  normalizeTimedBlocks,
  normalizeBlockTimerMinutes,
  getSiteBlockState
} = loadSitesModule();

test("normalizeHistoryExcludedSites defaults every tracked site to false", () => {
  const customSites = [createCustomSite("news.ycombinator.com")];
  const historyExcludedSites = normalizeHistoryExcludedSites(undefined, customSites);

  assert.equal(historyExcludedSites.twitter, false);
  assert.equal(historyExcludedSites.youtube, false);
  assert.equal(historyExcludedSites["custom:news.ycombinator.com"], false);
});

test("normalizeTimedBlocks keeps only active tracked-site timers", () => {
  const now = 1_000;
  const customSites = [createCustomSite("example.com")];
  const timedBlocks = normalizeTimedBlocks(
    {
      twitter: now + 60_000,
      "custom:example.com": now + 120_000,
      linkedin: now,
      missing: now + 90_000,
      youtube: Number.NaN
    },
    customSites,
    now
  );

  assert.deepEqual({ ...timedBlocks }, {
    twitter: now + 60_000,
    "custom:example.com": now + 120_000
  });
});

test("getSiteBlockState prefers an active timer over master block mode", () => {
  const blockState = getSiteBlockState("twitter", {
    isBlockModeEnabled: true,
    blockedSites: normalizeBlockedSites({ twitter: true }, []),
    timedBlocks: { twitter: 301_000 },
    now: 1_000
  });

  assert.equal(blockState.isBlocked, true);
  assert.equal(blockState.reason, "timer");
  assert.equal(blockState.remainingMinutes, 5);
});

test("getSiteBlockState falls back to master block mode when no timer is active", () => {
  const blockState = getSiteBlockState("twitter", {
    isBlockModeEnabled: true,
    blockedSites: normalizeBlockedSites({ twitter: true }, []),
    timedBlocks: { twitter: 1_000 },
    now: 1_000
  });

  assert.equal(blockState.isBlocked, true);
  assert.equal(blockState.reason, "mode");
  assert.equal(blockState.remainingMinutes, 0);
});

test("normalizeBlockTimerMinutes clamps invalid values into the supported range", () => {
  assert.equal(normalizeBlockTimerMinutes(undefined), 30);
  assert.equal(normalizeBlockTimerMinutes(0), 1);
  assert.equal(normalizeBlockTimerMinutes(1.4), 1);
  assert.equal(normalizeBlockTimerMinutes(1_500), 1440);
});
