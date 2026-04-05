const DAILY_COUNTS_KEY = "twitterDailyCounts";
const BLOCK_MODE_KEY = "twitterTrackerBlockMode";
const BLOCKED_SITES_KEY = "twitterTrackerBlockedSites";
const BADGE_COUNT_VISIBLE_KEY = "twitterTrackerBadgeCountVisible";
const BADGE_ID = "twitter-open-tracker-badge";
const BLOCKER_ID = "twitter-open-tracker-blocker";
const STAY_HARD_GIF_PATH = "media/stay-hard.gif";
const BLOCKER_SHADOW_STYLES = `
  :host {
    color: #f7f9f9;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  }

  *, *::before, *::after {
    box-sizing: border-box;
  }

  .twitter-open-tracker-blocker__panel {
    width: min(100%, 420px);
    min-height: 296px;
    display: flex;
    flex-direction: column;
    gap: 14px;
    justify-content: flex-start;
    padding: 28px 24px;
    border: 1px solid rgba(255, 255, 255, 0.12);
    border-radius: 24px;
    background: rgba(255, 255, 255, 0.05);
    box-shadow: 0 24px 60px rgba(0, 0, 0, 0.36);
    color: #f7f9f9;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  }

  .twitter-open-tracker-blocker__eyebrow,
  .twitter-open-tracker-blocker__copy,
  .twitter-open-tracker-blocker__count,
  .twitter-open-tracker-blocker__saved {
    margin: 0;
  }

  .twitter-open-tracker-blocker__eyebrow {
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: #8b98a5;
  }

  .twitter-open-tracker-blocker__title {
    margin: 10px 0 12px;
    font-size: clamp(28px, 4vw, 36px);
    line-height: 1.05;
    font-weight: 700;
    letter-spacing: normal;
    color: #f7f9f9;
  }

  .twitter-open-tracker-blocker__copy {
    color: rgba(247, 249, 249, 0.78);
    line-height: 1.5;
    font-size: 16px;
    font-weight: 400;
  }

  .twitter-open-tracker-blocker__media {
    border-radius: 20px;
    overflow: hidden;
    border: 1px solid rgba(255, 255, 255, 0.1);
    background: rgba(255, 255, 255, 0.04);
  }

  .twitter-open-tracker-blocker__media[hidden] {
    display: none;
  }

  .twitter-open-tracker-blocker__gif {
    display: block;
    width: 100%;
    aspect-ratio: 16 / 9;
    object-fit: cover;
  }

  .twitter-open-tracker-blocker__count {
    font-size: 14px;
    font-weight: 600;
    color: #86cbff;
  }

  .twitter-open-tracker-blocker__saved {
    font-size: 14px;
    font-weight: 600;
    color: #ffbf8e;
  }

  .twitter-open-tracker-blocker__button {
    margin-top: auto;
    align-self: flex-start;
    border: 0;
    border-radius: 999px;
    padding: 12px 16px;
    background: #1d9bf0;
    color: #fff;
    font: 700 16px/1.2 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    letter-spacing: normal;
    cursor: pointer;
    appearance: none;
  }

  .twitter-open-tracker-blocker__button:hover {
    background: #1a8cd8;
  }
`;

let customSitesState = [];
let trackedSiteMapState = getTrackedSiteMap(customSitesState);
let cachedDailyCounts = {};
let currentBadgeCount = 0;
let isBlockModeEnabled = false;
let isStayHardEnabled = false;
let isBadgeCountVisible = true;
let blockedSitesState = normalizeBlockedSites({}, customSitesState);
let badgeElement = null;
let blockerElement = null;
let isSurfaceMountScheduled = false;

function isExtensionContextInvalidatedError(error) {
  if (!error || typeof error !== "object") {
    return false;
  }

  return typeof error.message === "string" && error.message.includes("Extension context invalidated");
}

function reportContentScriptError(scope, error) {
  if (isExtensionContextInvalidatedError(error)) {
    return;
  }

  try {
    console.error(`[tracker:${scope}]`, error);
  } catch {
    // Ignore console failures in hostile page contexts.
  }
}

function isExtensionContextInvalidatedReason(reason) {
  if (isExtensionContextInvalidatedError(reason)) {
    return true;
  }

  return typeof reason === "string" && reason.includes("Extension context invalidated");
}

function hasLiveExtensionContext() {
  if (typeof chrome === "undefined") {
    return false;
  }

  try {
    return Boolean(chrome.runtime?.id);
  } catch (error) {
    reportContentScriptError("runtime-check", error);
    return false;
  }
}

window.addEventListener("error", (event) => {
  if (isExtensionContextInvalidatedReason(event.error ?? event.message)) {
    event.preventDefault();
  }
});

window.addEventListener("unhandledrejection", (event) => {
  if (isExtensionContextInvalidatedReason(event.reason)) {
    event.preventDefault();
  }
});

async function safeStorageGet(keys, fallback = {}) {
  if (!hasLiveExtensionContext()) {
    return fallback;
  }

  try {
    return await chrome.storage.local.get(keys);
  } catch (error) {
    reportContentScriptError("storage-get", error);
    return fallback;
  }
}

async function safeStorageSet(values) {
  if (!hasLiveExtensionContext()) {
    return false;
  }

  try {
    await chrome.storage.local.set(values);
    return true;
  } catch (error) {
    reportContentScriptError("storage-set", error);
    return false;
  }
}

async function safeRuntimeMessage(message) {
  if (!hasLiveExtensionContext()) {
    return null;
  }

  try {
    return await chrome.runtime.sendMessage(message);
  } catch (error) {
    reportContentScriptError("runtime-message", error);
    return null;
  }
}

function refreshTrackedSitesState() {
  trackedSiteMapState = getTrackedSiteMap(customSitesState);
  blockedSitesState = normalizeBlockedSites(blockedSitesState, customSitesState);
}

function getCurrentSiteId() {
  return findTrackedSiteIdByHostname(window.location.hostname, customSitesState);
}

function getNormalizedDayEntry(entry) {
  return normalizeDayEntry(entry, trackedSiteMapState);
}

function getNormalizedDailyCounts(dailyCounts) {
  return normalizeDailyCounts(dailyCounts, trackedSiteMapState);
}

function getTodayMetric(dailyCounts, siteId, metricKey, totalKey) {
  if (!dailyCounts || typeof dailyCounts !== "object") {
    return 0;
  }

  const todayEntry = getNormalizedDayEntry(dailyCounts[getTodayKey()]);
  return siteId ? (todayEntry[metricKey][siteId] ?? 0) : todayEntry[totalKey];
}

function formatMinutesSaved(minutes) {
  if (minutes < 60) {
    return `${minutes} minutes`;
  }

  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  if (remainder === 0) {
    return `${hours} hour${hours === 1 ? "" : "s"}`;
  }

  return `${hours} hour${hours === 1 ? "" : "s"} ${remainder} min`;
}

function ensureBadge() {
  if (badgeElement) {
    return badgeElement;
  }

  const badge = document.createElement("div");
  badge.id = BADGE_ID;
  badge.setAttribute("aria-live", "polite");
  badge.title = "Open Stay Hard controls";
  badge.addEventListener("click", async () => {
    await safeRuntimeMessage({ type: "OPEN_TRACKER_POPUP", siteId: getCurrentSiteId() });
  });
  badgeElement = badge;
  mountSurfaceElement(badgeElement);
  return badgeElement;
}

function ensureBlocker() {
  if (blockerElement) {
    return blockerElement;
  }

  const blocker = document.createElement("section");
  blocker.id = BLOCKER_ID;
  blocker.hidden = true;
  blocker.tabIndex = -1;
  blocker.setAttribute("aria-live", "polite");
  const shadowRoot = blocker.attachShadow({ mode: "open" });
  shadowRoot.innerHTML = `
    <style>${BLOCKER_SHADOW_STYLES}</style>
    <div class="twitter-open-tracker-blocker__panel">
      <p class="twitter-open-tracker-blocker__eyebrow">Block mode on</p>
      <div class="twitter-open-tracker-blocker__media" hidden>
        <img class="twitter-open-tracker-blocker__gif" alt="David Goggins saying stay hard">
      </div>
      <h1 class="twitter-open-tracker-blocker__title"></h1>
      <p class="twitter-open-tracker-blocker__copy"></p>
      <p class="twitter-open-tracker-blocker__count"></p>
      <p class="twitter-open-tracker-blocker__saved"></p>
      <button class="twitter-open-tracker-blocker__button" type="button">Open stay hard controls</button>
    </div>
  `;

  const blockerGif = shadowRoot.querySelector(".twitter-open-tracker-blocker__gif");
  if (blockerGif && hasLiveExtensionContext()) {
    blockerGif.src = chrome.runtime.getURL(STAY_HARD_GIF_PATH);
  }

  shadowRoot.querySelector("button")?.addEventListener("click", async () => {
    await safeRuntimeMessage({ type: "OPEN_TRACKER_POPUP", siteId: getCurrentSiteId() });
  });

  blockerElement = blocker;
  mountSurfaceElement(blockerElement);
  return blockerElement;
}

function mountSurfaceElement(element) {
  if (!element || element.isConnected) {
    return true;
  }

  if (!document.body) {
    scheduleSurfaceMount();
    return false;
  }

  document.body.appendChild(element);
  return true;
}

function scheduleSurfaceMount() {
  if (isSurfaceMountScheduled) {
    return;
  }

  if (document.body) {
    if (badgeElement && !badgeElement.isConnected) {
      document.body.appendChild(badgeElement);
    }

    if (blockerElement && !blockerElement.isConnected) {
      document.body.appendChild(blockerElement);
    }

    renderSurface();
    return;
  }

  isSurfaceMountScheduled = true;
  document.addEventListener(
    "DOMContentLoaded",
    () => {
      isSurfaceMountScheduled = false;
      if (badgeElement && !badgeElement.isConnected) {
        document.body?.appendChild(badgeElement);
      }

      if (blockerElement && !blockerElement.isConnected) {
        document.body?.appendChild(blockerElement);
      }

      renderSurface();
    },
    { once: true }
  );
}

function getBlockerShadowElement(selector) {
  const blocker = ensureBlocker();
  return blocker.shadowRoot?.querySelector(selector) ?? null;
}

function getTodayCount(dailyCounts, siteId) {
  return getTodayMetric(dailyCounts, siteId, "sites", "total");
}

function getTodayTotal(dailyCounts) {
  return getTodayMetric(dailyCounts, null, "sites", "total");
}

function getTodayBlockedCount(dailyCounts, siteId) {
  return getTodayMetric(dailyCounts, siteId, "blockedSites", "blockedTotal");
}

function getTodaySavedMinutes(dailyCounts, siteId) {
  return getTodayMetric(dailyCounts, siteId, "savedSites", "savedMinutes");
}

function getBadgeCount(dailyCounts, siteId) {
  return siteId ? getTodayCount(dailyCounts, siteId) : getTodayTotal(dailyCounts);
}

function renderCount(count) {
  const badge = ensureBadge();
  const siteId = getCurrentSiteId();
  const siteLabel = siteId ? (trackedSiteMapState[siteId]?.label ?? "Tracked site") : "All tracked sites";
  const shouldShowVisibleCount = siteId !== null && isBadgeCountVisible;
  badge.textContent = shouldShowVisibleCount ? `👀 ${count}` : "👀";
  badge.setAttribute("aria-label", `${siteLabel} opens today: ${count}`);
}

function renderBlocker() {
  const siteId = getCurrentSiteId();
  const siteLabel = siteId ? (trackedSiteMapState[siteId]?.label ?? "This site") : "This site";
  const eyebrow = getBlockerShadowElement(".twitter-open-tracker-blocker__eyebrow");
  const media = getBlockerShadowElement(".twitter-open-tracker-blocker__media");
  const title = getBlockerShadowElement(".twitter-open-tracker-blocker__title");
  const copy = getBlockerShadowElement(".twitter-open-tracker-blocker__copy");
  const countElement = getBlockerShadowElement(".twitter-open-tracker-blocker__count");
  const savedElement = getBlockerShadowElement(".twitter-open-tracker-blocker__saved");
  const blockedTodayCount = getTodayBlockedCount(cachedDailyCounts, siteId);
  const savedTodayMinutes = getTodaySavedMinutes(cachedDailyCounts, siteId);

  if (!eyebrow || !media || !title || !copy || !countElement || !savedElement) {
    return;
  }

  eyebrow.textContent = isStayHardEnabled ? "Stay hard mode" : "Block mode on";
  media.hidden = !isStayHardEnabled;
  title.textContent = isStayHardEnabled ? "Stay hard." : `${siteLabel} is blocked`;
  copy.textContent = isStayHardEnabled
    ? `You tried to open ${siteLabel}. Close the tab, keep moving, and come back only if it still matters.`
    : `Stay Hard is hiding ${siteLabel} until you switch that site's blocker off.`;
  countElement.textContent = `You tried to open this blocked page ${blockedTodayCount} time${blockedTodayCount === 1 ? "" : "s"} today.`;
  savedElement.textContent = `We saved you about ${formatMinutesSaved(savedTodayMinutes)} from blocked opens today.`;
}

function isCurrentSiteBlocked() {
  const currentSiteId = getCurrentSiteId();
  return currentSiteId !== null && isBlockModeEnabled && blockedSitesState[currentSiteId] === true;
}

function renderSurface() {
  const badge = ensureBadge();
  const blocker = ensureBlocker();
  const isBadgeMounted = mountSurfaceElement(badge);
  const isBlockerMounted = mountSurfaceElement(blocker);

  if (!isBadgeMounted || !isBlockerMounted) {
    return;
  }

  const shouldShowBlocker = isCurrentSiteBlocked();

  if (shouldShowBlocker) {
    renderBlocker();
  } else {
    renderCount(currentBadgeCount);
  }

  badge.hidden = shouldShowBlocker;
  blocker.hidden = !shouldShowBlocker;
  document.documentElement.classList.toggle("twitter-open-tracker-page-blocked", shouldShowBlocker);

  if (shouldShowBlocker) {
    blocker.focus({ preventScroll: true });
  }
}

async function initializeBadge() {
  const storedValues = await safeStorageGet([
    DAILY_COUNTS_KEY,
    BLOCK_MODE_KEY,
    BLOCKED_SITES_KEY,
    BADGE_COUNT_VISIBLE_KEY,
    CUSTOM_SITES_KEY,
    STAY_HARD_ENABLED_KEY
  ]);
  ensureBadge();

  customSitesState = normalizeCustomSites(storedValues[CUSTOM_SITES_KEY]);
  blockedSitesState = normalizeBlockedSites(storedValues[BLOCKED_SITES_KEY], customSitesState);
  refreshTrackedSitesState();
  cachedDailyCounts = getNormalizedDailyCounts(storedValues[DAILY_COUNTS_KEY]);
  currentBadgeCount = getBadgeCount(cachedDailyCounts, getCurrentSiteId());
  isBlockModeEnabled = storedValues[BLOCK_MODE_KEY] === true;
  isStayHardEnabled = storedValues[STAY_HARD_ENABLED_KEY] === true;
  isBadgeCountVisible = storedValues[BADGE_COUNT_VISIBLE_KEY] !== false;
  renderSurface();
}

if (hasLiveExtensionContext()) {
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== "local") {
      return;
    }

    if (changes[CUSTOM_SITES_KEY]) {
      customSitesState = normalizeCustomSites(changes[CUSTOM_SITES_KEY].newValue);
      refreshTrackedSitesState();
      cachedDailyCounts = getNormalizedDailyCounts(cachedDailyCounts);
    }

    if (changes[DAILY_COUNTS_KEY]) {
      cachedDailyCounts = getNormalizedDailyCounts(changes[DAILY_COUNTS_KEY].newValue);
    }

    if (changes[BLOCK_MODE_KEY]) {
      isBlockModeEnabled = changes[BLOCK_MODE_KEY].newValue === true;
    }

    if (changes[BLOCKED_SITES_KEY]) {
      blockedSitesState = normalizeBlockedSites(changes[BLOCKED_SITES_KEY].newValue, customSitesState);
    }

    if (changes[BADGE_COUNT_VISIBLE_KEY]) {
      isBadgeCountVisible = changes[BADGE_COUNT_VISIBLE_KEY].newValue !== false;
    }

    if (changes[STAY_HARD_ENABLED_KEY]) {
      isStayHardEnabled = changes[STAY_HARD_ENABLED_KEY].newValue === true;
    }

    currentBadgeCount = getBadgeCount(cachedDailyCounts, getCurrentSiteId());
    renderSurface();
  });
}

initializeBadge().catch((error) => {
  reportContentScriptError("initialize", error);
});
