
const API_BASE = "http://127.0.0.1:8000";
const MAX_HISTORY = 12;

const scanButton = document.getElementById("scanButton");
const statusText = document.getElementById("status");
const resultSection = document.getElementById("result");

const chatForm = document.getElementById("chatForm");
const chatInput = document.getElementById("chatInput");
const sendButton = document.getElementById("sendButton");
const chatMessages = document.getElementById("chatMessages");

const snapshotButton = document.getElementById("snapshotButton");
const imageInput = document.getElementById("imageInput");
const snapshotPanel = document.getElementById("snapshotPanel");
const snapshotPreview = document.getElementById("snapshotPreview");
const cancelSnapshot = document.getElementById("cancelSnapshot");
const sendSnapshot = document.getElementById("sendSnapshot");
const snapshotStatus = document.getElementById("snapshotStatus");

const regionCaptureButton = document.getElementById("regionCaptureButton");
const captureSource = document.getElementById("captureSource");

let selectedImageDataUrl = "";
let selectedImageUrl = "";

// Keep conversation context for follow-up questions.
let conversationHistory = [];

function showStatus(message) {
  statusText.textContent = message;
}

function showError(message) {
  resultSection.hidden = true;
  showStatus(message);
}

function addMessage(role, text, labelText = "") {
  const bubble = document.createElement("div");
  bubble.className = `message ${role}`;

  const label = document.createElement("span");
  label.className = "message-label";
  label.textContent =
    labelText || (role === "user" ? "You" : "GuardianAI");

  const body = document.createElement("p");
  body.textContent = text;

  bubble.append(label, body);
  chatMessages.appendChild(bubble);
  chatMessages.scrollTop = chatMessages.scrollHeight;

  return bubble;
}

function addHistory(role, content) {
  conversationHistory.push({ role, content });
  conversationHistory = conversationHistory.slice(-MAX_HISTORY);
}

async function readError(response) {
  try {
    const data = await response.json();
    return data.detail || data.error ||
      `Request failed (${response.status}).`;
  } catch {
    return `Request failed (${response.status}).`;
  }
}

function displayAnalysis(data) {
  const validRisks = ["low", "medium", "high", "urgent"];

  if (
    !validRisks.includes(data.risk_level) ||
    typeof data.category !== "string" ||
    typeof data.explanation !== "string" ||
    typeof data.recommended_action !== "string"
  ) {
    throw new Error("The backend returned an unexpected response.");
  }

  document.getElementById("riskLevel").textContent = data.risk_level;
  document.getElementById("riskLevel").dataset.risk = data.risk_level;
  document.getElementById("category").textContent = data.category;
  document.getElementById("explanation").textContent = data.explanation;
  document.getElementById("action").textContent = data.recommended_action;

  resultSection.hidden = false;
}

function formatAnalysis(data) {
  return [
    "Here's what I think this text may mean:",
    data.explanation,
    "",
    `Safety category: ${data.category}`,
    `Risk level: ${data.risk_level}`,
    "",
    "What you can do:",
    data.recommended_action
  ].join("\n");
}

// --------------------------------------------------
// 1. Explain selected text INSIDE the chat thread
// --------------------------------------------------

async function loadSelectedTextReport() {
  const params = new URLSearchParams(location.search);
  if (params.get("mode") !== "text-report") return;

  scanButton.disabled = true;
  resultSection.hidden = true;

  try {
    const stored = await chrome.storage.local.get("guardianSelectedText");
    const selection = stored.guardianSelectedText;

    if (!selection?.text?.trim()) {
      throw new Error(
        "No selected text was found. Select text and right-click again."
      );
    }

    // Remove the saved selection so it cannot be reused accidentally.
    await chrome.storage.local.remove("guardianSelectedText");

    if (captureSource) {
      captureSource.textContent =
        `Selected from: ${selection.pageTitle || "Webpage"}`;
      captureSource.hidden = false;
    }

    // Put the selected paragraph into the conversation.
    const selectedText = selection.text.slice(0, 6000);
    addMessage("user", selectedText, "You · Selected text");
    addHistory("user", selectedText);

    showStatus("GuardianAI is understanding the selected text...");

    const response = await fetch(`${API_BASE}/analyze`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: selectedText })
    });

    if (!response.ok) throw new Error(await readError(response));

    const data = await response.json();

    if (
      !data ||
      typeof data.explanation !== "string" ||
      typeof data.category !== "string" ||
      typeof data.risk_level !== "string" ||
      typeof data.recommended_action !== "string"
    ) {
      throw new Error("The backend returned an unexpected response.");
    }

    // Show the explanation as a normal GuardianAI chat message.
    const explanation = formatAnalysis(data);
    addMessage("assistant", explanation);
    addHistory("assistant", explanation);

    showStatus(
      "Explanation ready. You can ask GuardianAI a follow-up question below."
    );
  } catch (error) {
    addMessage(
      "assistant",
      `I couldn't explain that text just now. ${error.message}`
    );
    showError(error.message || "Couldn't explain the selected text.");
  } finally {
    scanButton.disabled = false;
  }
}

// --------------------------------------------------
// 2. Start area capture
// --------------------------------------------------

if (regionCaptureButton) {
  regionCaptureButton.addEventListener("click", async () => {
    regionCaptureButton.disabled = true;

    try {
      const [tab] = await chrome.tabs.query({
        active: true,
        currentWindow: true
      });

      if (!tab?.id || !tab.url?.startsWith("http")) {
        throw new Error("Open a regular website before capturing an area.");
      }

      await chrome.tabs.sendMessage(tab.id, {
        type: "GUARDIAN_START_REGION_CAPTURE"
      });
    } catch (error) {
      alert(
        "GuardianAI couldn't start area selection. Refresh the webpage and try again."
      );
    } finally {
      regionCaptureButton.disabled = false;
    }
  });
}

// --------------------------------------------------
// 3. Manual page scan
// --------------------------------------------------

scanButton.addEventListener("click", async () => {
  scanButton.disabled = true;
  resultSection.hidden = true;
  showStatus("Reading page text...");

  try {
    const [tab] = await chrome.tabs.query({
      active: true,
      currentWindow: true
    });

    if (!tab?.id || !tab.url?.startsWith("http")) {
      throw new Error("Open a regular website and try again.");
    }

    let page;

    try {
      page = await chrome.tabs.sendMessage(tab.id, {
        type: "GUARDIAN_SCAN"
      });
    } catch {
      throw new Error(
        "GuardianAI couldn't access this page. Refresh it and try again."
      );
    }

    if (!page?.success || !page.text?.trim()) {
      throw new Error("No readable page text was found.");
    }

    showStatus("Analyzing page text...");

    const response = await fetch(`${API_BASE}/analyze`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: page.text.slice(0, 6000) })
    });

    if (!response.ok) throw new Error(await readError(response));

    displayAnalysis(await response.json());
    showStatus("Analysis complete. Review the result carefully.");
  } catch (error) {
    showError(error.message || "Something went wrong. Please try again.");
  } finally {
    scanButton.disabled = false;
  }
});

// --------------------------------------------------
// 4. Chat with conversation history
// --------------------------------------------------

chatForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  const message = chatInput.value.trim();
  if (!message || sendButton.disabled) return;

  addMessage("user", message);
  addHistory("user", message);

  chatInput.value = "";
  sendButton.disabled = true;
  chatInput.disabled = true;

  const loading = addMessage("assistant", "GuardianAI is thinking...");

  try {
    const response = await fetch(`${API_BASE}/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message,
        history: conversationHistory
          .slice(0, -1)
          .slice(-MAX_HISTORY)
      })
    });

    if (!response.ok) throw new Error(await readError(response));

    const data = await response.json();
    const reply = data.reply || data.response || data.message;

    if (typeof reply !== "string" || !reply.trim()) {
      throw new Error("The AI returned an empty response.");
    }

    loading.remove();
    addMessage("assistant", reply);
    addHistory("assistant", reply);
  } catch (error) {
    loading.remove();

    // Remove the unanswered user turn from the history so it isn't
    // mistakenly sent as completed context on the next attempt.
    conversationHistory.pop();

    addMessage(
      "assistant",
      `I couldn't connect just now. Please try again in a moment. (${error.message})`
    );
  } finally {
    sendButton.disabled = false;
    chatInput.disabled = false;
    chatInput.focus();
  }
});

// --------------------------------------------------
// 5. Image preview helpers
// --------------------------------------------------

function showImage(dataUrl) {
  if (selectedImageUrl) URL.revokeObjectURL(selectedImageUrl);
  selectedImageUrl = "";

  selectedImageDataUrl = dataUrl;
  snapshotPreview.src = dataUrl;
  snapshotPanel.hidden = false;
  snapshotStatus.textContent = "";
}

function clearImage() {
  selectedImageDataUrl = "";
  snapshotPreview.removeAttribute("src");
  snapshotPanel.hidden = true;
  snapshotStatus.textContent = "";
  imageInput.value = "";
}

snapshotButton.addEventListener("click", async () => {
  snapshotStatus.textContent = "Capturing the visible tab...";

  try {
    const [tab] = await chrome.tabs.query({
      active: true,
      currentWindow: true
    });

    if (!tab?.id || !tab.url?.startsWith("http")) {
      throw new Error("Open a regular website before taking a snapshot.");
    }

    const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, {
      format: "png"
    });

    showImage(dataUrl);
    snapshotStatus.textContent =
      "Preview ready. Check it for private details before sending.";
  } catch (error) {
    snapshotStatus.textContent =
      `Couldn't capture this tab: ${error.message}`;
  }
});

imageInput.addEventListener("change", () => {
  const file = imageInput.files?.[0];
  if (!file) return;

  if (file.size > 5 * 1024 * 1024) {
    snapshotStatus.textContent = "Choose an image smaller than 5 MB.";
    imageInput.value = "";
    return;
  }

  if (!["image/png", "image/jpeg", "image/webp"].includes(file.type)) {
    snapshotStatus.textContent = "Please choose a PNG, JPEG, or WebP image.";
    imageInput.value = "";
    return;
  }

  const reader = new FileReader();

  reader.onload = () => {
    if (typeof reader.result === "string") {
      showImage(reader.result);
      snapshotStatus.textContent =
        "Image ready. Check it for private details before sending.";
    }
  };

  reader.onerror = () => {
    snapshotStatus.textContent = "Couldn't read that image.";
  };

  reader.readAsDataURL(file);
});

cancelSnapshot.addEventListener("click", clearImage);

// --------------------------------------------------
// 6. Analyze selected or captured image
// --------------------------------------------------

sendSnapshot.addEventListener("click", async () => {
  if (!selectedImageDataUrl) {
    snapshotStatus.textContent = "Take or select an image first.";
    return;
  }

  sendSnapshot.disabled = true;
  snapshotStatus.textContent = "Analyzing the image...";

  try {
    const response = await fetch(`${API_BASE}/analyze-image`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ image: selectedImageDataUrl })
    });

    if (!response.ok) throw new Error(await readError(response));

    const data = await response.json();

    const explanation = [
      data.explanation || data.reply || data.summary ||
        "Image analysis completed.",
      data.category ? `Category: ${data.category}` : "",
      data.risk_level ? `Risk level: ${data.risk_level}` : "",
      data.recommended_action
        ? `Suggested next step: ${data.recommended_action}`
        : ""
    ].filter(Boolean).join("\n\n");

    addMessage("assistant", explanation);
    addHistory("assistant", explanation);

    snapshotStatus.textContent = "Analysis complete.";

    const params = new URLSearchParams(location.search);
    if (params.get("mode") === "report") {
      await chrome.storage.local.remove("guardianPendingCapture");
    }
  } catch (error) {
    snapshotStatus.textContent =
      `Image analysis failed: ${error.message}`;
  } finally {
    sendSnapshot.disabled = false;
  }
});

// --------------------------------------------------
// 7. Load a region capture for review
// --------------------------------------------------

async function loadPendingCapture() {
  const params = new URLSearchParams(location.search);
  if (params.get("mode") !== "report") return;

  try {
    const stored = await chrome.storage.local.get("guardianPendingCapture");
    const capture = stored.guardianPendingCapture;

    if (!capture?.image) {
      snapshotStatus.textContent =
        "No captured image was found. Please capture an area again.";
      snapshotPanel.hidden = false;
      return;
    }

    showImage(capture.image);

    if (captureSource) {
      captureSource.textContent =
        `Captured from: ${capture.pageTitle || "Webpage"}`;
      captureSource.hidden = false;
    }

    snapshotStatus.textContent =
      "Review the selected area. Nothing is uploaded until you choose Analyze image.";
  } catch {
    snapshotPanel.hidden = false;
    snapshotStatus.textContent = "Couldn't load the captured image.";
  }
}

void loadSelectedTextReport();
void loadPendingCapture();
