const DAILY_COUNTS_KEY = "twitterDailyCounts";
const BADGE_POSITION_KEY = "twitterTrackerBadgePosition";
const BADGE_ID = "twitter-open-tracker-badge";
const DEFAULT_BADGE_POSITION = { top: 16, left: null, right: 16 };

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
  await chrome.storage.local.set({ [BADGE_POSITION_KEY]: position });
}

async function loadBadgePosition() {
  const stored = await chrome.storage.local.get(BADGE_POSITION_KEY);
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
      await chrome.runtime.sendMessage({ type: "OPEN_TRACKER_POPUP" });
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

function getTodayCount(dailyCounts) {
  if (!dailyCounts || typeof dailyCounts !== "object") {
    return 0;
  }

  return dailyCounts[getTodayKey()] ?? 0;
}

function renderCount(count) {
  const badge = ensureBadge();
  badge.textContent = `Twitter opens today: ${count}`;
}

async function initializeBadge() {
  const badge = ensureBadge();
  const [storedCounts, storedPosition] = await Promise.all([
    chrome.storage.local.get(DAILY_COUNTS_KEY),
    loadBadgePosition()
  ]);

  applyBadgePosition(badge, storedPosition);
  renderCount(getTodayCount(storedCounts[DAILY_COUNTS_KEY]));
}

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "local") {
    return;
  }

  const badge = ensureBadge();

  if (changes[DAILY_COUNTS_KEY]) {
    renderCount(getTodayCount(changes[DAILY_COUNTS_KEY].newValue));
  }

  if (changes[BADGE_POSITION_KEY]) {
    applyBadgePosition(badge, changes[BADGE_POSITION_KEY].newValue ?? DEFAULT_BADGE_POSITION);
  }
});

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

initializeBadge();
