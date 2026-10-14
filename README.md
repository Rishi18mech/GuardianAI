# GuardianAI 🛡️

**GuardianAI is a Chrome extension that helps users inspect webpage
content and images for potentially suspicious or unsafe material, with
AI-powered explanations and follow-up chat.**

It uses a Chrome extension frontend, a FastAPI backend, and the Google
Gemini API. The backend is deployed on Render so the extension can make
requests without requiring each user to run the API server locally.

> **Project status:** Working prototype. AI assessments can be wrong; do
> not treat them as a guarantee that a page, message, or image is safe.

## Features

-   **Webpage analysis** --- send page content for an AI-assisted safety
    assessment.
-   **Screenshot / image analysis** --- analyze an image or selected
    region through the backend.
-   **Follow-up chat** --- ask questions about an analysis.
-   **Hosted backend** --- the extension calls the deployed Render
    service.
-   **Server-side API key** --- the Gemini API key belongs in backend
    environment variables, not in extension code.

## Architecture

``` text
Chrome extension
  ├── popup UI
  ├── content script
  └── background service worker
          │ HTTPS requests
          ▼
FastAPI backend (Render)
          │
          ▼
Google Gemini API
```

## Live backend

-   **Base URL:** https://guardianai-api-7h84.onrender.com
-   **Health check:** https://guardianai-api-7h84.onrender.com/health
-   **API docs:** https://guardianai-api-7h84.onrender.com/docs

The free Render service may sleep after a period of inactivity, so its
first request after being idle can take longer. Availability and
model/API quotas depend on the hosting and Gemini accounts.

## Install the Chrome extension

1.  Clone or download this repository.
2.  Open Chrome and visit `chrome://extensions`.
3.  Turn on **Developer mode**.
4.  Select **Load unpacked**.
5.  Choose the repository's `extension` folder.
6.  Open a webpage and click the GuardianAI extension to try its
    available analysis and chat features.

If you change extension files, return to `chrome://extensions` and click
**Reload** on GuardianAI.

## Backend: run locally

Requirements: Python 3.10+ (use a version compatible with the installed
dependencies) and a Google Gemini API key.

### 1. Open the backend folder

``` powershell
cd backend
```

### 2. Create and activate a virtual environment

``` powershell
py -m venv .venv
.\.venv\Scripts\Activate.ps1
```

If PowerShell blocks activation, you can invoke the virtual
environment's Python directly instead:

``` powershell
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
```

### 3. Install dependencies

``` powershell
python -m pip install -r requirements.txt
```

### 4. Configure environment variables

Create a file named `.env` inside `backend/`:

``` dotenv
GEMINI_API_KEY=put_your_own_key_here
```

Use the variable names expected by `backend/main.py`. If the model is
configurable in your version, set the model variable documented in that
file as well. Never commit `.env` or share your API key.

### 5. Start the server

``` powershell
python -m uvicorn main:app --reload --host 127.0.0.1 --port 8000
```

Local API base URL: `http://127.0.0.1:8000`

For local development, update the extension's backend URL and manifest
host permissions as needed, then reload the extension in Chrome. The
committed extension configuration may point to the hosted Render backend
by default.

## API routes

  Method   Route              Purpose
  -------- ------------------ ----------------------------------------
  `GET`    `/health`          Health and service configuration check
  `POST`   `/analyze`         Analyze webpage/text content
  `POST`   `/analyze-image`   Analyze image content
  `POST`   `/chat`            Ask a follow-up question

Request and response fields are defined in `backend/main.py`. For
interactive API exploration, open the hosted `/docs` URL or run the
backend locally and visit `http://127.0.0.1:8000/docs`.

## Repository structure

``` text
GuardianAI/
├── backend/
│   ├── main.py
│   ├── requirements.txt
│   ├── check_models.py
│   └── test_gemini.py
└── extension/
    ├── manifest.json
    ├── background.js
    ├── content.js
    ├── popup.html
    ├── popup.css
    ├── popup.js
    ├── icons/
    └── images/
```

## Security and responsible use

-   Keep `GEMINI_API_KEY` in Render's environment variables or your
    local, ignored `.env` file.
-   Never hardcode API keys in the extension or commit secrets to
    GitHub.
-   Treat webpage text and images as untrusted input.
-   AI output may be inaccurate or incomplete. Independently verify
    important safety decisions.
-   Before exposing the backend to broader public use, add suitable
    request validation, rate limiting, abuse protection, and monitoring.
    Do not assume a public demo endpoint is protected from misuse.

## Troubleshooting

-   **The extension cannot reach the backend:** confirm the Render
    service is live, check the base URL in `extension/background.js` and
    `extension/popup.js`, and ensure `extension/manifest.json` permits
    the Render host. Reload the extension after changing files.
-   **First request is slow:** the free Render instance may be waking
    from sleep.
-   **Gemini request fails:** check Render logs and verify the
    server-side `GEMINI_API_KEY` environment variable and account quota.
    Never paste the key into an issue or chat.
-   **Changes do not appear in Chrome:** save the files and click
    **Reload** on `chrome://extensions`.

## Demo

A short demo video with subtitles can be added here once recorded:

`[Add demo video link here]`

------------------------------------------------------------------------

Built as a hackathon prototype. Contributions, testing, and feedback are
welcome.
