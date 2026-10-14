
const BACKEND_URL = "http://127.0.0.1:8000/analyze";
const MAX_TEXT_LENGTH = 6000;
const MIN_SCAN_INTERVAL_MS = 5000;

const lastScanByTab = new Map();
const latestTextByTab = new Map();
const inFlightTabs = new Set();

// --------------------------------------------------
// 1. Context menu
// --------------------------------------------------


 // --------------------------------------------------
 // 1. Context menus
 // --------------------------------------------------

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: "guardian-capture-region",
      title: "Capture an area with GuardianAI",
      contexts: ["page", "selection", "image"]
    });

    chrome.contextMenus.create({
      id: "guardian-explain-selection",
      title: "Explain selected text with GuardianAI",
      contexts: ["selection"]
    });
  });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (tab?.id === undefined) return;

  if (info.menuItemId === "guardian-capture-region") {
    startRegionCapture(tab.id);
    return;
  }

  if (info.menuItemId === "guardian-explain-selection") {
    const selectedText = String(info.selectionText || "")
      .trim()
      .slice(0, MAX_TEXT_LENGTH);

    if (!selectedText) return;

    chrome.storage.local.set({
      guardianSelectedText: {
        text: selectedText,
        pageTitle: tab.title || "Webpage",
        pageUrl: tab.url || "",
        capturedAt: Date.now()
      }
    }, () => {
      chrome.tabs.create({
        url: chrome.runtime.getURL("popup.html?mode=text-report")
      });
    });
  }
});

async function startRegionCapture(tabId) {
  try {
    await chrome.tabs.sendMessage(tabId, {
      type: "GUARDIAN_START_REGION_CAPTURE"
    });
  } catch (error) {
    console.warn("GuardianAI could not start region capture:", error);
  }
}


// --------------------------------------------------
// 2. Messages from content.js
// --------------------------------------------------

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "GUARDIAN_AUTO_SCAN") {
    const tabId = sender.tab?.id;

    if (tabId === undefined || !message.text) {
      sendResponse({
        success: false,
        error: "Missing tab or page text."
      });
      return;
    }

    latestTextByTab.set(tabId, {
      text: String(message.text).slice(0, MAX_TEXT_LENGTH),
      pageTitle: message.pageTitle || "Untitled page",
      pageUrl: message.pageUrl || ""
    });

    sendResponse({ success: true, queued: true });

    if (!inFlightTabs.has(tabId)) {
      void processTab(tabId);
    }

    return;
  }

  if (message?.type === "GUARDIAN_REGION_SELECTED") {
    const tab = sender.tab;

    if (tab?.id === undefined || !message.rect) {
      sendResponse({
        success: false,
        error: "Missing tab or selection coordinates."
      });
      return;
    }

    // Keep the message channel open while the screenshot is cropped.
    cropAndPrepareReport(tab, message)
      .then(() => sendResponse({ success: true }))
      .catch(error => {
        console.error("GuardianAI region capture failed:", error);
        sendResponse({
          success: false,
          error: "Couldn't capture that area. Please try again."
        });
      });

    return true;
  }
});

// --------------------------------------------------
// 3. Crop the selected visible region
// --------------------------------------------------

async function cropAndPrepareReport(tab, message) {
  const rect = message.rect;

  if (
    !Number.isFinite(rect.x) ||
    !Number.isFinite(rect.y) ||
    !Number.isFinite(rect.width) ||
    !Number.isFinite(rect.height) ||
    rect.width < 8 ||
    rect.height < 8 ||
    rect.viewportWidth <= 0 ||
    rect.viewportHeight <= 0
  ) {
    throw new Error("Invalid selection rectangle.");
  }

  const screenshotUrl = await chrome.tabs.captureVisibleTab(
    tab.windowId,
    { format: "png" }
  );

  const response = await fetch(screenshotUrl);
  const screenshotBlob = await response.blob();
  const bitmap = await createImageBitmap(screenshotBlob);

  const scaleX = bitmap.width / rect.viewportWidth;
  const scaleY = bitmap.height / rect.viewportHeight;

  const sx = Math.max(0, Math.floor(rect.x * scaleX));
  const sy = Math.max(0, Math.floor(rect.y * scaleY));
  const sw = Math.min(
    bitmap.width - sx,
    Math.ceil(rect.width * scaleX)
  );
  const sh = Math.min(
    bitmap.height - sy,
    Math.ceil(rect.height * scaleY)
  );

  if (sw <= 0 || sh <= 0) {
    bitmap.close();
    throw new Error("Selected area is outside the screenshot.");
  }

  const canvas = new OffscreenCanvas(sw, sh);
  const context = canvas.getContext("2d");

  if (!context) {
    bitmap.close();
    throw new Error("Image cropping is unavailable.");
  }

  context.drawImage(bitmap, sx, sy, sw, sh, 0, 0, sw, sh);
  bitmap.close();

  const croppedBlob = await canvas.convertToBlob({
    type: "image/png"
  });

  const bytes = new Uint8Array(await croppedBlob.arrayBuffer());
  let binary = "";

  // Convert in chunks to avoid an oversized function call.
  const chunkSize = 0x8000;

  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(
      ...bytes.subarray(i, i + chunkSize)
    );
  }

  const imageDataUrl =
    "data:image/png;base64," + btoa(binary);

  await chrome.storage.local.set({
    guardianPendingCapture: {
      image: imageDataUrl,
      pageTitle: message.pageTitle || tab.title || "Untitled page",
      pageUrl: message.pageUrl || tab.url || "",
      capturedAt: Date.now()
    }
  });

  await chrome.tabs.create({
    url: chrome.runtime.getURL("popup.html?mode=report")
  });
}

// --------------------------------------------------
// 4. Automatic text assessment
// --------------------------------------------------

async function processTab(tabId) {
  if (inFlightTabs.has(tabId)) return;

  inFlightTabs.add(tabId);

  try {
    while (latestTextByTab.has(tabId)) {
      const lastScan = lastScanByTab.get(tabId) || 0;
      const waitMs =
        MIN_SCAN_INTERVAL_MS - (Date.now() - lastScan);

      if (waitMs > 0) {
        await new Promise(resolve => setTimeout(resolve, waitMs));
      }

      const snapshot = latestTextByTab.get(tabId);
      if (!snapshot) break;

      latestTextByTab.delete(tabId);
      lastScanByTab.set(tabId, Date.now());

      const response = await fetch(BACKEND_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: snapshot.text })
      });

      if (!response.ok) {
        console.error(
          "GuardianAI assessment failed:",
          response.status,
          await response.text()
        );
        continue;
      }

      const result = await response.json();

      await chrome.storage.local.set({
        [`guardianResult_${tabId}`]: {
          ...result,
          pageTitle: snapshot.pageTitle,
          pageUrl: snapshot.pageUrl,
          assessedAt: Date.now()
        }
      });

      const risk = String(result.risk_level || "").toLowerCase();

      if (["medium", "high", "urgent"].includes(risk)) {
        const notificationId = `guardian-${tabId}-${Date.now()}`;

        const title =
          risk === "urgent"
            ? "GuardianAI wants to check on you"
            : risk === "high"
            ? "Your bodyguard is checking in"
            : "GuardianAI has a quick question";

        chrome.notifications.create(notificationId, {
          type: "basic",
          iconUrl: chrome.runtime.getURL("icons/icon128.png"),
          title,
          message: "Hey, friend. Are you okay?",
          buttons: [
            { title: "Yes, I'm okay" },
            { title: "Not really" }
          ],
          priority: risk === "medium" ? 1 : 2,
          requireInteraction: true
        }, createdId => {
          if (chrome.runtime.lastError) {
            console.error(
              "GuardianAI notification failed:",
              chrome.runtime.lastError.message
            );
          }
        });
      }

      chrome.runtime.sendMessage({
        type: "GUARDIAN_ASSESSMENT_READY",
        tabId,
        result
      }).catch(() => {
        // The popup may be closed.
      });
    }
  } catch (error) {
    console.error("GuardianAI background error:", error);
  } finally {
    inFlightTabs.delete(tabId);

    if (latestTextByTab.has(tabId)) {
      void processTab(tabId);
    }
  }
}

// --------------------------------------------------
// 5. Bodyguard notification responses
// --------------------------------------------------

chrome.notifications.onButtonClicked.addListener(
  async (notificationId, buttonIndex) => {
    const match = notificationId.match(/^guardian-(\d+)-/);
    if (!match) return;

    if (buttonIndex === 0) {
      await chrome.storage.local.set({
        guardianBuddyMood: "happy",
        guardianCheckIn: "okay"
      });

      chrome.notifications.clear(notificationId);

      await chrome.tabs.create({
        url: chrome.runtime.getURL("popup.html?mode=happy")
      });
    } else if (buttonIndex === 1) {
      await chrome.storage.local.set({
        guardianBuddyMood: "serious",
        guardianCheckIn: "needs_support",
        guardianChatStarter:
          "I'm here to listen. What happened? You can tell me in your own words."
      });

      chrome.notifications.clear(notificationId);

      await chrome.tabs.create({
        url: chrome.runtime.getURL("popup.html?mode=serious")
      });
    }
  }
);

// --------------------------------------------------
// 6. Clean up closed tabs
// --------------------------------------------------

chrome.tabs.onRemoved.addListener(tabId => {
  lastScanByTab.delete(tabId);
  latestTextByTab.delete(tabId);
  inFlightTabs.delete(tabId);

  void chrome.storage.local.remove(`guardianResult_${tabId}`);
});
