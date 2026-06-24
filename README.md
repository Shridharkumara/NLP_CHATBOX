# NeuralChat — Advanced NLP AI Chatbot
### Built for AI/ML Placement Portfolio

A production-style AI chatbot with a **Node/Express backend**, powered by **Google's Gemini API** — which has a genuinely free tier, no credit card required. The key lives on the server, so any visitor can use the chatbot without entering their own key. Features NLP analysis, chat history, markdown rendering with code highlighting, an analytics dashboard, and more.

---

## Why Gemini?

This project originally used the Anthropic Claude API, which is excellent but pay-as-you-go with no free tier — every request needs a funded account. Google's Gemini API offers a real free tier (`gemini-2.5-flash`) that works with just a Google account, no billing setup required. Functionally the app behaves the same either way; only `server.js`'s API call changed.

If you later want to switch to a different provider (OpenAI, Anthropic, Groq, etc.), only `server.js` needs to change — the frontend, dashboard, and analytics all stay exactly the same, since they only ever talk to your own `/api/chat` and `/api/nlp-analyze` endpoints.

---

## Why a Backend?

Putting an API key directly in frontend JavaScript means anyone who views the page source can copy it and use it themselves. This version avoids that:

- **You** put your key once in a `.env` file on the server.
- The **browser** never sees the key — it only talks to your own `/api/chat` endpoint.
- Your server forwards the request to Gemini and returns just the answer.
- Built-in **rate limiting** stops any one visitor from exhausting your free-tier quota.

---

## Setup (VS Code)

> ⚠️ **Do not double-click `index.html`, and do not use the VS Code "Live Server" extension for this project.** This app only works when it's served by the Node server below. Opening the file directly (`file://...`) or through Live Server (usually `127.0.0.1:5500`) means the chat and dashboard can't reach `/api/chat` or `/api/analytics` at all. Always go through `npm start` → `http://localhost:3000`.

### 1. Install Node.js
Download from [nodejs.org](https://nodejs.org) if you don't already have it (v18+ required — this app uses the built-in `fetch`, no extra HTTP library needed).

### 2. Set up the folder structure
Make sure your project looks like this — frontend files belong **inside** a `public` subfolder, everything else stays at the top level:

```
your-project-folder/
├── public/
│   ├── index.html
│   ├── app.js
│   ├── style.css
│   ├── dashboard.html
│   ├── dashboard.js
│   └── dashboard.css
├── server.js
├── package.json
├── .env.example
├── .gitignore
└── render.yaml
```

### 3. Install dependencies
Open the project folder in VS Code, open a terminal (`` Ctrl+` ``), and run:
```bash
npm install
```
You should see a new `node_modules` folder appear afterward.

### 4. Get a free Gemini API key
1. Go to [aistudio.google.com/apikey](https://aistudio.google.com/apikey)
2. Sign in with a Google account
3. Click **Create API key** — no payment info required
4. Copy the key it shows you

### 5. Add your key
```bash
cp .env.example .env
```
(On Windows, if `cp` isn't recognized, use `copy .env.example .env` instead.)

Open `.env` and replace the placeholder with your real key:
```
GEMINI_API_KEY=your-actual-key-from-ai-studio
```

### 6. Start the server
```bash
npm start
```
You'll see:
```
✅ NeuralChat server running at http://localhost:3000
   Dashboard: http://localhost:3000/dashboard.html
   Gemini API key loaded — visitors can chat immediately.
```
Leave this terminal window open — closing it stops the server.

### 7. Open it the right way
Go to **http://localhost:3000** in your browser's address bar — not a Live Server tab, not a double-clicked file.

---

## Free Tier Limits (Good to Know)

Gemini's free tier is real, but it does have limits — roughly 5–15 requests per minute and a daily cap, depending on the model and how Google's adjusting quotas at the time. For a portfolio project or personal use this is normally plenty. If you ever hit the limit, the chat UI will show a clear "rate limited, try again in a minute" message rather than failing silently — this is expected behavior, not a bug.

---

## Troubleshooting

### "Cannot find module 'dotenv'" (or 'express', etc.) when running `npm start`

You haven't run `npm install` yet in this exact folder, or it didn't complete. Run `npm install` and wait for it to finish — you should see a `node_modules` folder appear. Then try `npm start` again.

### "Cannot GET /" or "Cannot GET /dashboard.html"

Your frontend files (`index.html`, `app.js`, etc.) aren't inside a folder named exactly `public`. `server.js` only serves files from `public/` — see the folder structure above. Fix: create a `public` folder and move `index.html`, `app.js`, `style.css`, `dashboard.html`, `dashboard.js`, and `dashboard.css` into it, then restart the server.

### "Server error (405)" or "404" on /api/chat — and your address bar shows a port other than 3000 (e.g. 5500)

You're viewing the page through VS Code's **Live Server** extension instead of the real Node server. Live Server doesn't know about `/api/chat` or any backend route — only `server.js` does. Close that tab, make sure `npm start` is running, and open `http://localhost:3000` directly. The app detects this automatically now and shows an on-screen explanation instead of failing silently.

### "Nothing happens at all when I send a message — terminal shows nothing"

Check your browser's address bar. If it shows `file:///...`, you opened `index.html` by double-clicking it instead of starting the server. Relative API calls like `fetch('/api/chat')` don't work on `file://` pages. Run `npm start`, then open `http://localhost:3000`.

### "The Gemini API key was rejected"

Most often this means `.env` still has the placeholder text (`your-real-gemini-key-here`) instead of your actual key, or there's a typo/extra space. Open `.env`, confirm the line reads exactly `GEMINI_API_KEY=` followed immediately by your real key with no quotes or spaces, save, and restart the server (Ctrl+C then `npm start`).

### "You've hit Gemini's free-tier rate limit"

This is expected if you send many messages quickly — the free tier caps requests per minute. Wait about 60 seconds and try again.

---

## Analytics Dashboard

Open **http://localhost:3000/dashboard.html** (or click the chart icon in the chat's top bar) to see:

- **Status pill** — live server health + uptime, polls every 5s
- **Metric cards** — total requests, success rate, average response time (+ p95), estimated tokens used
- **Request volume chart** — bar chart of requests per hour
- **Sentiment donut** — breakdown of positive/negative/neutral results from the NLP Analyze tool
- **Live log feed** — a scrolling tail of every request with timestamp, route, status, and latency

This data is stored in memory on the server and resets when you restart it — fine for a portfolio/demo project.

---

## How It Works

```
Browser (app.js)  →  POST /api/chat  →  Your Server (server.js)  →  Gemini API
                                              ↑
                                    .env holds GEMINI_API_KEY
                                    (never sent to the browser)
```

- `public/app.js` calls `fetch('/api/chat', ...)` — a relative URL on your own server.
- `server.js` receives that, attaches your real Gemini key server-side, converts the message format (Gemini expects `role: "model"` instead of `"assistant"`, and a different request shape than Anthropic), and calls Gemini's REST API directly via `fetch` — no extra SDK dependency needed.
- The response text comes back through your server to the browser.
- `express-rate-limit` caps each visitor's request rate so your free-tier quota lasts.

---

## Deploying So Others Can Use It Online

Right now this runs on your machine (`localhost`). Here's the easiest path to a public URL, using **Render** (free tier, no credit card needed):

### Step 1 — Push to GitHub
```bash
git init
git add .
git commit -m "NeuralChat ready to deploy"
```
Create a new repo on [github.com/new](https://github.com/new), then:
```bash
git remote add origin https://github.com/YOUR_USERNAME/YOUR_REPO.git
git branch -M main
git push -u origin main
```
The `.gitignore` already keeps `.env` and `node_modules` out of the repo.

### Step 2 — Deploy on Render
1. Go to [render.com](https://render.com) and sign up / log in
2. Click **New +** → **Blueprint**
3. Connect your GitHub repo — Render detects `render.yaml` automatically
4. When prompted for `GEMINI_API_KEY`, paste your real key from AI Studio
5. Click **Apply** / **Create**

### Step 3 — Done
You'll get a public URL like `https://neuralchat-xxxx.onrender.com`. Anyone with that link can chat — no key, no setup needed on their end.

> **Free tier note:** Render's free web services spin down after 15 minutes of inactivity and take ~30–50 seconds to wake back up. Normal behavior, not a bug.

> **Quota tip:** the rate limiter in `server.js` is already set conservatively (10 requests/minute) to help your Gemini free-tier quota stretch further across multiple visitors. Lower it further if you're sharing the link widely.

---

## Features

- **Real AI Conversations** — Powered by Gemini, no key needed by visitors, genuinely free
- **NLP Analysis Panel** — Sentiment, intent, entities, keywords
- **Chat History** — Persistent sessions (stored in browser localStorage)
- **Markdown Rendering** — Tables, code blocks, headings, lists
- **Syntax Highlighting** — Code blocks with one-click copy
- **Summarize & Translate** — One-click NLP tools on any AI response
- **Export Chat** — Download conversations as .txt
- **Rate Limiting** — Protects your free-tier quota from abuse
- **Analytics Dashboard** — Live request volume, sentiment mix, latency, log feed
- **Responsive Design** — Works on desktop and mobile

---

## Key Technical Concepts (For Interviews)

| Concept | Implementation |
|---------|---------------|
| Client-server architecture | Express backend + static frontend |
| Secrets management | `.env` + `dotenv`, never exposed to client |
| REST API design | `/api/chat`, `/api/nlp-analyze`, `/api/analytics` endpoints |
| Rate limiting | `express-rate-limit` middleware |
| Third-party API integration | Raw `fetch` calls to Gemini's REST API, no SDK dependency |
| NLP pipeline | Sentiment, NER, intent detection via LLM |
| Async/await | All API calls, both client and server side |
| Markdown parsing | `marked.js` |
| Syntax highlighting | `highlight.js` |
| Data visualization | Hand-built SVG charts, no charting library |

---

## Interview Talking Points

- "I built a full client-server chatbot — Express backend, vanilla JS frontend"
- "The API key is never exposed to the browser; the backend proxies requests to Gemini"
- "I integrated a third-party LLM API directly via REST, handling the request/response format differences myself instead of relying on an SDK"
- "I added rate limiting per-IP to protect the free-tier quota from abuse"
- "NLP features like sentiment and entity extraction run through dedicated backend endpoints"
- "I built an analytics dashboard from scratch with hand-drawn SVG charts to show request volume, latency percentiles, and sentiment distribution"

---

## Tech Stack

- **Frontend**: Vanilla HTML, CSS, JavaScript
- **Backend**: Node.js + Express
- **AI**: Google Gemini (`gemini-2.5-flash`) via direct REST calls
- **Libraries**: marked.js (markdown), highlight.js (code), express-rate-limit, cors, dotenv
- **Storage**: Browser localStorage (chat history), `.env` (secrets)

---

*Built as a placement portfolio project demonstrating full-stack AI integration skills.*
