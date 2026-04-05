const DAILY_COUNTS_KEY = "twitterDailyCounts";
const BADGE_POSITION_KEY = "twitterTrackerBadgePosition";
const BLOCK_MODE_KEY = "twitterTrackerBlockMode";
const BLOCKED_SITES_KEY = "twitterTrackerBlockedSites";
const BADGE_ID = "twitter-open-tracker-badge";
const BLOCKER_ID = "twitter-open-tracker-blocker";
const DEFAULT_BADGE_POSITION = { top: 16, left: null, right: 16 };
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
  .twitter-open-tracker-blocker__count {
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

  .twitter-open-tracker-blocker__count {
    margin-top: 14px;
    font-size: 14px;
    font-weight: 600;
    color: #86cbff;
  }

  .twitter-open-tracker-blocker__button {
    margin-top: 18px;
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
let blockedSitesState = normalizeBlockedSites({}, customSitesState);

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

function normalizeDayEntry(entry) {
  if (typeof entry === "number") {
    return {
      total: entry,
      sites: entry > 0 && trackedSiteMapState.twitter ? { twitter: entry } : {}
    };
  }

  if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
    return {
      total: 0,
      sites: {}
    };
  }

  const sites =
    entry.sites && typeof entry.sites === "object" && !Array.isArray(entry.sites)
      ? Object.fromEntries(
          Object.entries(entry.sites)
            .filter(([siteId, count]) => siteId in trackedSiteMapState && Number.isFinite(count) && count > 0)
            .map(([siteId, count]) => [siteId, count])
        )
      : {};
  const derivedTotal = Object.values(sites).reduce((sum, count) => sum + count, 0);
  const total = Number.isFinite(entry.total) && entry.total >= derivedTotal ? entry.total : derivedTotal;

  return {
    total,
    sites
  };
}

function normalizeDailyCounts(dailyCounts) {
  if (!dailyCounts || typeof dailyCounts !== "object" || Array.isArray(dailyCounts)) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(dailyCounts).map(([dateKey, entry]) => [dateKey, normalizeDayEntry(entry)])
  );
}

function getTodayKey() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function applyBadgePosition(badge, position = DEFAULT_BADGE_POSITION) {
  badge.style.top = `${position.top ?? DEFAULT_BADGE_POSITION.top}px`;
  badge.style.left = position.left == null ? "auto" : `${position.left}px`;
  badge.style.right = position.right == null ? "auto" : `${position.right}px`;
}

async function saveBadgePosition(position) {
  await safeStorageSet({ [BADGE_POSITION_KEY]: position });
}

async function loadBadgePosition() {
  const stored = await safeStorageGet(BADGE_POSITION_KEY);
  const position = stored[BADGE_POSITION_KEY];

  if (!position || typeof position !== "object" || Array.isArray(position)) {
    return DEFAULT_BADGE_POSITION;
  }

  return {
    top: typeof position.top === "number" ? position.top : DEFAULT_BADGE_POSITION.top,
    left: typeof position.left === "number" ? position.left : null,
    right: typeof position.right === "number" ? position.right : null
  };
}

function enableDragging(badge) {
  if (badge.dataset.dragEnabled === "true") {
    return;
  }

  badge.dataset.dragEnabled = "true";

  let dragState = null;
  let didDrag = false;

  badge.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) {
      return;
    }

    const rect = badge.getBoundingClientRect();
    dragState = {
      offsetX: event.clientX - rect.left,
      offsetY: event.clientY - rect.top,
      startX: event.clientX,
      startY: event.clientY,
      width: rect.width,
      height: rect.height
    };

    didDrag = false;
    badge.setPointerCapture(event.pointerId);
    badge.classList.add("is-dragging");
    event.preventDefault();
  });

  badge.addEventListener("pointermove", (event) => {
    if (!dragState) {
      return;
    }

    const movedX = Math.abs(event.clientX - dragState.startX);
    const movedY = Math.abs(event.clientY - dragState.startY);
    if (movedX > 4 || movedY > 4) {
      didDrag = true;
    }

    const maxLeft = window.innerWidth - dragState.width - 8;
    const maxTop = window.innerHeight - dragState.height - 8;
    const left = clamp(event.clientX - dragState.offsetX, 8, Math.max(8, maxLeft));
    const top = clamp(event.clientY - dragState.offsetY, 8, Math.max(8, maxTop));

    applyBadgePosition(badge, { top, left, right: null });
  });

  async function finishDrag(event) {
    if (!dragState) {
      return;
    }

    const rect = badge.getBoundingClientRect();
    const position = {
      top: Math.round(rect.top),
      left: Math.round(rect.left),
      right: null
    };

    dragState = null;
    badge.classList.remove("is-dragging");

    if (event.pointerId != null && badge.hasPointerCapture(event.pointerId)) {
      badge.releasePointerCapture(event.pointerId);
    }

    await saveBadgePosition(position);

    if (!didDrag) {
      await safeRuntimeMessage({ type: "OPEN_TRACKER_POPUP", siteId: getCurrentSiteId() });
    }
  }

  badge.addEventListener("pointerup", finishDrag);
  badge.addEventListener("pointercancel", finishDrag);
}

function ensureBadge() {
  let badge = document.getElementById(BADGE_ID);

  if (badge) {
    return badge;
  }

  badge = document.createElement("div");
  badge.id = BADGE_ID;
  badge.setAttribute("aria-live", "polite");
  badge.title = "Drag to move";
  document.documentElement.appendChild(badge);
  enableDragging(badge);
  return badge;
}

function ensureBlocker() {
  let blocker = document.getElementById(BLOCKER_ID);

  if (blocker) {
    return blocker;
  }

  blocker = document.createElement("section");
  blocker.id = BLOCKER_ID;
  blocker.hidden = true;
  blocker.tabIndex = -1;
  blocker.setAttribute("aria-live", "polite");
  const shadowRoot = blocker.attachShadow({ mode: "open" });
  shadowRoot.innerHTML = `
    <style>${BLOCKER_SHADOW_STYLES}</style>
    <div class="twitter-open-tracker-blocker__panel">
      <p class="twitter-open-tracker-blocker__eyebrow">Block mode on</p>
      <h1 class="twitter-open-tracker-blocker__title"></h1>
      <p class="twitter-open-tracker-blocker__copy"></p>
      <p class="twitter-open-tracker-blocker__count"></p>
      <button class="twitter-open-tracker-blocker__button" type="button">Open tracker controls</button>
    </div>
  `;

  shadowRoot.querySelector("button")?.addEventListener("click", async () => {
    await safeRuntimeMessage({ type: "OPEN_TRACKER_POPUP", siteId: getCurrentSiteId() });
  });

  document.documentElement.appendChild(blocker);
  return blocker;
}

function getBlockerShadowElement(selector) {
  const blocker = ensureBlocker();
  return blocker.shadowRoot?.querySelector(selector) ?? null;
}

function getTodayCount(dailyCounts, siteId) {
  if (!dailyCounts || typeof dailyCounts !== "object") {
    return 0;
  }

  const todayEntry = normalizeDayEntry(dailyCounts[getTodayKey()]);
  return todayEntry.sites[siteId] ?? 0;
}

function getTodayTotal(dailyCounts) {
  if (!dailyCounts || typeof dailyCounts !== "object") {
    return 0;
  }

  return normalizeDayEntry(dailyCounts[getTodayKey()]).total;
}

function getBadgeCount(dailyCounts, siteId) {
  return siteId ? getTodayCount(dailyCounts, siteId) : getTodayTotal(dailyCounts);
}

function renderCount(count) {
  const badge = ensureBadge();
  const siteId = getCurrentSiteId();
  const siteLabel = siteId ? (trackedSiteMapState[siteId]?.label ?? "Tracked site") : "All tracked sites";
  badge.textContent = "👀";
  badge.setAttribute("aria-label", `${siteLabel} opens today: ${count}`);
}

function renderBlocker(count) {
  const siteId = getCurrentSiteId();
  const siteLabel = siteId ? (trackedSiteMapState[siteId]?.label ?? "This site") : "This site";
  const title = getBlockerShadowElement(".twitter-open-tracker-blocker__title");
  const copy = getBlockerShadowElement(".twitter-open-tracker-blocker__copy");
  const countElement = getBlockerShadowElement(".twitter-open-tracker-blocker__count");

  if (!title || !copy || !countElement) {
    return;
  }

  title.textContent = `${siteLabel} is blocked`;
  copy.textContent =
    `Social Open Tracker is hiding ${siteLabel} until you switch that site's blocker off.`;
  countElement.textContent =
    `Today's ${siteLabel} opens: ${count}`;
}

function isCurrentSiteBlocked() {
  const currentSiteId = getCurrentSiteId();
  return currentSiteId !== null && isBlockModeEnabled && blockedSitesState[currentSiteId] === true;
}

function renderSurface() {
  const badge = ensureBadge();
  const blocker = ensureBlocker();
  const shouldShowBlocker = isCurrentSiteBlocked();

  badge.hidden = shouldShowBlocker;
  blocker.hidden = !shouldShowBlocker;
  document.documentElement.classList.toggle("twitter-open-tracker-page-blocked", shouldShowBlocker);

  if (shouldShowBlocker) {
    renderBlocker(currentBadgeCount);
    blocker.focus({ preventScroll: true });
    return;
  }

  renderCount(currentBadgeCount);
}

async function initializeBadge() {
  const storedValues = await safeStorageGet([
    DAILY_COUNTS_KEY,
    BLOCK_MODE_KEY,
    BLOCKED_SITES_KEY,
    CUSTOM_SITES_KEY
  ]);
  const storedPosition = await loadBadgePosition();
  const badge = ensureBadge();

  customSitesState = normalizeCustomSites(storedValues[CUSTOM_SITES_KEY]);
  blockedSitesState = normalizeBlockedSites(storedValues[BLOCKED_SITES_KEY], customSitesState);
  refreshTrackedSitesState();
  cachedDailyCounts = normalizeDailyCounts(storedValues[DAILY_COUNTS_KEY]);
  currentBadgeCount = getBadgeCount(cachedDailyCounts, getCurrentSiteId());
  isBlockModeEnabled = storedValues[BLOCK_MODE_KEY] === true;

  applyBadgePosition(badge, storedPosition);
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
      cachedDailyCounts = normalizeDailyCounts(cachedDailyCounts);
    }

    if (changes[DAILY_COUNTS_KEY]) {
      cachedDailyCounts = normalizeDailyCounts(changes[DAILY_COUNTS_KEY].newValue);
    }

    if (changes[BADGE_POSITION_KEY]) {
      applyBadgePosition(ensureBadge(), changes[BADGE_POSITION_KEY].newValue ?? DEFAULT_BADGE_POSITION);
    }

    if (changes[BLOCK_MODE_KEY]) {
      isBlockModeEnabled = changes[BLOCK_MODE_KEY].newValue === true;
    }

    if (changes[BLOCKED_SITES_KEY]) {
      blockedSitesState = normalizeBlockedSites(changes[BLOCKED_SITES_KEY].newValue, customSitesState);
    }

    currentBadgeCount = getBadgeCount(cachedDailyCounts, getCurrentSiteId());
    renderSurface();
  });
}

window.addEventListener("resize", async () => {
  const badge = document.getElementById(BADGE_ID);
  if (!badge) {
    return;
  }

  const rect = badge.getBoundingClientRect();
  const top = clamp(rect.top, 8, Math.max(8, window.innerHeight - rect.height - 8));
  const left = clamp(rect.left, 8, Math.max(8, window.innerWidth - rect.width - 8));
  const position = {
    top: Math.round(top),
    left: Math.round(left),
    right: null
  };

  applyBadgePosition(badge, position);
  await saveBadgePosition(position);
});

initializeBadge().catch((error) => {
  reportContentScriptError("initialize", error);
});
