
let scanTimer = null;
let lastSentText = "";
let isScanning = false;
let selectionActive = false;

const MAX_TEXT_LENGTH = 6000;

// --------------------------------------------------
// 1. Read visible page text
// --------------------------------------------------

function getVisiblePageText() {
  return (document.body?.innerText || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_TEXT_LENGTH);
}

// --------------------------------------------------
// 2. Automatic safety scanning
// --------------------------------------------------

function scheduleAutomaticScan() {
  if (scanTimer !== null) {
    clearTimeout(scanTimer);
  }

  scanTimer = setTimeout(() => {
    scanTimer = null;
    scanPageAutomatically();
  }, 1200);
}

function scanPageAutomatically() {
  if (isScanning || selectionActive) return;

  const text = getVisiblePageText();

  if (!text || text === lastSentText) return;

  lastSentText = text;
  isScanning = true;

  chrome.runtime.sendMessage(
    {
      type: "GUARDIAN_AUTO_SCAN",
      text,
      pageTitle: document.title || "Untitled page",
      pageUrl: location.href
    },
    () => {
      // Accessing lastError prevents an unchecked runtime error.
      void chrome.runtime.lastError;
      isScanning = false;
    }
  );
}

// --------------------------------------------------
// 3. Manual page scan
// --------------------------------------------------

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "GUARDIAN_SCAN") {
    const text = getVisiblePageText();

    sendResponse({
      success: Boolean(text),
      text,
      pageTitle: document.title || "Untitled page",
      pageUrl: location.href
    });

    return;
  }

  if (message?.type === "GUARDIAN_START_REGION_CAPTURE") {
    if (selectionActive) {
      sendResponse({
        success: false,
        error: "A region selection is already active."
      });
      return;
    }

    startRegionSelection();
    sendResponse({ success: true });
  }
});

// --------------------------------------------------
// 4. Drag-to-select region capture
// --------------------------------------------------

function startRegionSelection() {
  if (selectionActive || !document.documentElement) return;

  selectionActive = true;

  const overlay = document.createElement("div");
  overlay.id = "guardianai-region-overlay";

  Object.assign(overlay.style, {
    position: "fixed",
    inset: "0",
    zIndex: "2147483647",
    cursor: "crosshair",
    background: "rgba(10, 20, 35, 0.25)",
    touchAction: "none",
    userSelect: "none"
  });

  const instruction = document.createElement("div");
  instruction.textContent =
    "GuardianAI — Drag to select an area · Esc to cancel";

  Object.assign(instruction.style, {
    position: "absolute",
    top: "16px",
    left: "50%",
    transform: "translateX(-50%)",
    padding: "12px 16px",
    maxWidth: "90vw",
    borderRadius: "10px",
    background: "#14243a",
    color: "#ffffff",
    font: "14px/1.4 Arial, sans-serif",
    textAlign: "center",
    boxShadow: "0 4px 16px rgba(0,0,0,.25)",
    pointerEvents: "none"
  });

  const selection = document.createElement("div");

  Object.assign(selection.style, {
    position: "absolute",
    display: "none",
    border: "2px solid #35d0a0",
    background: "rgba(53, 208, 160, 0.12)",
    boxSizing: "border-box",
    pointerEvents: "none"
  });

  overlay.append(instruction, selection);
  document.documentElement.appendChild(overlay);

  let startX = 0;
  let startY = 0;
  let dragging = false;
  let finished = false;

  function removeOverlay() {
    overlay.remove();
    document.removeEventListener("keydown", onKeyDown, true);
    selectionActive = false;
  }

  function onKeyDown(event) {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      finished = true;
      removeOverlay();
    }
  }

  function onPointerDown(event) {
    if (event.button !== 0 || finished) return;

    event.preventDefault();
    event.stopPropagation();

    startX = Math.max(0, Math.min(event.clientX, window.innerWidth));
    startY = Math.max(0, Math.min(event.clientY, window.innerHeight));
    dragging = true;

    selection.style.display = "block";
    selection.style.left = `${startX}px`;
    selection.style.top = `${startY}px`;
    selection.style.width = "0px";
    selection.style.height = "0px";

    try {
      overlay.setPointerCapture(event.pointerId);
    } catch {
      // Pointer capture may be unavailable on some pages.
    }
  }

  function onPointerMove(event) {
    if (!dragging || finished) return;

    event.preventDefault();

    const currentX = Math.max(
      0,
      Math.min(event.clientX, window.innerWidth)
    );
    const currentY = Math.max(
      0,
      Math.min(event.clientY, window.innerHeight)
    );

    selection.style.left = `${Math.min(startX, currentX)}px`;
    selection.style.top = `${Math.min(startY, currentY)}px`;
    selection.style.width = `${Math.abs(currentX - startX)}px`;
    selection.style.height = `${Math.abs(currentY - startY)}px`;
  }

  function onPointerUp(event) {
    if (!dragging || finished) return;

    event.preventDefault();
    event.stopPropagation();

    dragging = false;

    const endX = Math.max(
      0,
      Math.min(event.clientX, window.innerWidth)
    );
    const endY = Math.max(
      0,
      Math.min(event.clientY, window.innerHeight)
    );

    const rect = {
      x: Math.min(startX, endX),
      y: Math.min(startY, endY),
      width: Math.abs(endX - startX),
      height: Math.abs(endY - startY),
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
      devicePixelRatio: window.devicePixelRatio || 1
    };

    if (rect.width < 8 || rect.height < 8) {
      instruction.textContent =
        "Selection too small. Press Esc to cancel, then try again.";
      return;
    }

    finished = true;
    removeOverlay();

    // Allow the browser to repaint without the selection overlay
    // before the background script captures the visible tab.
    requestAnimationFrame(() => {
      setTimeout(() => {
        chrome.runtime.sendMessage(
          {
            type: "GUARDIAN_REGION_SELECTED",
            rect,
            pageTitle: document.title || "Untitled page",
            pageUrl: location.href
          },
          () => {
            void chrome.runtime.lastError;
          }
        );
      }, 100);
    });
  }

  overlay.addEventListener("pointerdown", onPointerDown, true);
  overlay.addEventListener("pointermove", onPointerMove, true);
  overlay.addEventListener("pointerup", onPointerUp, true);
  document.addEventListener("keydown", onKeyDown, true);
}

// --------------------------------------------------
// 5. Watch for dynamically updated page content
// --------------------------------------------------

const pageObserver = new MutationObserver(() => {
  scheduleAutomaticScan();
});

function startMonitoring() {
  if (!document.body) return;

  pageObserver.observe(document.body, {
    childList: true,
    subtree: true,
    characterData: true
  });

  scheduleAutomaticScan();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", startMonitoring, {
    once: true
  });
} else {
  startMonitoring();
}
