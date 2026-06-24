/**
 * NeuralChat Backend Server
 * ---------------------------------------------
 * Holds the Gemini API key server-side (in .env) so that
 * ANY visitor can chat without needing their own key.
 * Also tracks lightweight in-memory analytics for the dashboard.
 *
 * Uses Google's Gemini API (gemini-2.5-flash) via plain REST calls —
 * no SDK dependency needed, just Node's built-in fetch (Node 18+).
 * Gemini has a genuinely free tier: no credit card required to start.
 * Get a key at https://aistudio.google.com/apikey
 *
 * IMPORTANT: This server never hard-crashes on a missing/bad key.
 * If the key is missing, it still starts and serves the UI, but
 * /api/chat returns a clear, friendly error instead of failing silently.
 */

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');

const app = express();
const PORT = process.env.PORT || 3000;

// ---------------------------------------------
// API key handling — never exit the process.
// A missing key is a configuration problem the
// /api/health and /api/chat routes report clearly,
// not a reason to kill the whole server.
// ---------------------------------------------
const API_KEY = process.env.GEMINI_API_KEY || '';
const KEY_CONFIGURED = API_KEY.length > 10; // Gemini keys don't have a fixed prefix like sk-ant-

if (!KEY_CONFIGURED) {
  console.warn('\n⚠️  GEMINI_API_KEY is missing.');
  console.warn('   The server will still start, and the dashboard will work,');
  console.warn('   but chat requests will fail until you:');
  console.warn('   1. Copy .env.example to .env');
  console.warn('   2. Get a free key at https://aistudio.google.com/apikey');
  console.warn('   3. Paste it into .env as GEMINI_API_KEY=...');
  console.warn('   4. Restart the server (npm start)\n');
}

const GEMINI_MODEL = 'gemini-2.5-flash'; // Google's recommended free-tier model
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

// ---------------------------------------------
// In-memory analytics store
// Resets when the server restarts — fine for a
// portfolio/demo dashboard. Swap for a real DB
// (SQLite/Postgres) if you need persistence.
// ---------------------------------------------
const analytics = {
  startedAt: new Date().toISOString(),
  totalRequests: 0,
  totalErrors: 0,
  totalTokensEstimate: 0,
  sentimentCounts: { positive: 0, negative: 0, neutral: 0 },
  responseTimes: [], // ms, capped
  log: [],            // recent events, capped
  requestsByHour: {}, // "2026-06-16T14:00" -> count
};

const MAX_LOG = 100;
const MAX_RESPONSE_TIMES = 200;

function recordEvent(event) {
  analytics.log.unshift({ ...event, time: new Date().toISOString() });
  if (analytics.log.length > MAX_LOG) analytics.log.length = MAX_LOG;
}

function recordRequest({ ok, ms, tokensEstimate, sentiment, route }) {
  analytics.totalRequests += 1;
  if (!ok) analytics.totalErrors += 1;
  if (tokensEstimate) analytics.totalTokensEstimate += tokensEstimate;
  if (sentiment && analytics.sentimentCounts[sentiment] !== undefined) {
    analytics.sentimentCounts[sentiment] += 1;
  }
  if (typeof ms === 'number') {
    analytics.responseTimes.push(ms);
    if (analytics.responseTimes.length > MAX_RESPONSE_TIMES) analytics.responseTimes.shift();
  }

  const hourKey = new Date().toISOString().slice(0, 13) + ':00';
  analytics.requestsByHour[hourKey] = (analytics.requestsByHour[hourKey] || 0) + 1;

  recordEvent({
    type: ok ? 'success' : 'error',
    route,
    ms,
    sentiment: sentiment || null,
  });
}

// ---------------------------------------------
// Middleware
// ---------------------------------------------
app.use(cors());
app.use(express.json({ limit: '1mb' }));
app.use(express.static('public'));

const chatLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10, // Gemini free tier is rate-limited (often 5-15 req/min) — keep this conservative
  message: { error: 'Too many requests. Please wait a moment and try again.' },
  standardHeaders: true,
  legacyHeaders: false,
});

app.use('/api/chat', chatLimiter);
app.use('/api/nlp-analyze', chatLimiter);

// ---------------------------------------------
// System prompt
// ---------------------------------------------
const SYSTEM_PROMPT = `You are NeuralChat, an advanced AI assistant specializing in Artificial Intelligence, Machine Learning, Natural Language Processing, Data Science, and Computer Science. You provide clear, accurate, and educational responses.

Key behaviors:
- For technical topics, provide working code examples with explanations
- For ML/AI questions, explain concepts clearly with real-world examples
- Format code in proper markdown code blocks with language tags
- Be helpful for placement/interview preparation
- Provide comprehensive but focused answers
- Use markdown formatting for better readability`;

// ---------------------------------------------
// Helpers
// ---------------------------------------------
function sanitizeMessages(messages) {
  if (!Array.isArray(messages)) return [];
  return messages
    .filter(m => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
    .slice(-20)
    .map(m => ({ role: m.role, content: m.content.slice(0, 8000) }));
}

function estimateTokens(text) {
  return Math.ceil((text || '').length / 4);
}

// Gemini uses a different message shape than Anthropic:
// - role "model" instead of "assistant"
// - { parts: [{ text }] } instead of plain { content }
// - system prompt goes in a separate top-level field, not the messages array
function toGeminiContents(messages) {
  return messages.map(m => ({
    role: m.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: m.content }],
  }));
}

// Calls Gemini's REST API directly. Throws an Error with a `.status`
// property on failure, mirroring how the Anthropic SDK behaved, so
// the existing error-handling blocks below still work unchanged.
async function callGemini({ contents, systemInstruction, maxOutputTokens }) {
  const body = {
    contents,
    generationConfig: { maxOutputTokens: maxOutputTokens || 2048 },
  };
  if (systemInstruction) {
    body.systemInstruction = { parts: [{ text: systemInstruction }] };
  }

  const res = await fetch(`${GEMINI_URL}?key=${API_KEY}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    const message = data?.error?.message || `Gemini API error (${res.status})`;
    const err = new Error(message);
    err.status = res.status;
    throw err;
  }

  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) {
    // Common cause: the response was blocked by safety filters
    const finishReason = data?.candidates?.[0]?.finishReason;
    if (finishReason && finishReason !== 'STOP') {
      const err = new Error(`Gemini stopped the response early (${finishReason}). Try rephrasing your message.`);
      err.status = 422;
      throw err;
    }
    const err = new Error('No response received from Gemini.');
    err.status = 502;
    throw err;
  }

  return text;
}

// ---------------------------------------------
// Routes
// ---------------------------------------------

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', keyConfigured: KEY_CONFIGURED, uptimeMs: Date.now() - new Date(analytics.startedAt).getTime() });
});

app.post('/api/chat', async (req, res) => {
  const start = Date.now();
  try {
    if (!KEY_CONFIGURED) {
      recordRequest({ ok: false, ms: Date.now() - start, route: '/api/chat' });
      return res.status(503).json({
        error: 'Server is missing a valid GEMINI_API_KEY. Add one to .env and restart the server.',
      });
    }

    const messages = sanitizeMessages(req.body.messages);
    if (messages.length === 0) {
      return res.status(400).json({ error: 'No valid messages provided.' });
    }

    const text = await callGemini({
      contents: toGeminiContents(messages),
      systemInstruction: SYSTEM_PROMPT,
      maxOutputTokens: 2048,
    });

    const ms = Date.now() - start;
    const tokensEstimate = estimateTokens(messages.map(m => m.content).join(' ')) + estimateTokens(text);

    recordRequest({ ok: true, ms, tokensEstimate, route: '/api/chat' });
    res.json({ text });
  } catch (err) {
    console.error('Chat error:', err.message);
    recordRequest({ ok: false, ms: Date.now() - start, route: '/api/chat' });

    let friendlyMessage = err.message || 'Something went wrong talking to the AI service.';
    if (err.status === 404) {
      friendlyMessage = `The configured Gemini model isn't available (${err.message}). Check GEMINI_MODEL in server.js.`;
    } else if (err.status === 400 && /API key/i.test(err.message || '')) {
      friendlyMessage = 'The Gemini API key was rejected. Double-check GEMINI_API_KEY in .env.';
    } else if (err.status === 403) {
      friendlyMessage = 'The Gemini API key was rejected or lacks permission. Double-check GEMINI_API_KEY in .env.';
    } else if (err.status === 429) {
      friendlyMessage = "You've hit Gemini's free-tier rate limit — wait a minute and try again.";
    } else if (err.status === 503) {
      friendlyMessage = "Gemini's servers are temporarily overloaded. Try again shortly.";
    }

    res.status(err.status || 500).json({ error: friendlyMessage });
  }
});

app.post('/api/nlp-analyze', async (req, res) => {
  const start = Date.now();
  try {
    if (!KEY_CONFIGURED) {
      recordRequest({ ok: false, ms: Date.now() - start, route: '/api/nlp-analyze' });
      return res.status(503).json({
        error: 'Server is missing a valid GEMINI_API_KEY. Add one to .env and restart the server.',
      });
    }

    const text = (req.body.text || '').slice(0, 4000);
    if (!text.trim()) {
      return res.status(400).json({ error: 'No text provided.' });
    }

    const prompt = `Analyze this text for NLP properties. Return ONLY valid JSON with no markdown:
{
  "sentiment": "positive|negative|neutral",
  "sentiment_score": 0.0,
  "intent": "question|statement|command|request",
  "entities": ["list", "of", "key", "entities"],
  "keywords": ["list", "of", "keywords"],
  "language": "English",
  "word_count": 0,
  "complexity": "simple|moderate|complex"
}

Text: "${text.replace(/"/g, "'")}"`;

    const raw = await callGemini({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      maxOutputTokens: 300,
    });

    const cleaned = raw.replace(/```json|```/g, '').trim();
    const analysis = JSON.parse(cleaned);

    const ms = Date.now() - start;
    recordRequest({ ok: true, ms, sentiment: analysis.sentiment, route: '/api/nlp-analyze' });
    res.json(analysis);
  } catch (err) {
    console.error('NLP analysis error:', err.message);
    recordRequest({ ok: false, ms: Date.now() - start, route: '/api/nlp-analyze' });
    res.status(err.status || 500).json({ error: 'Analysis failed.' });
  }
});

// Dashboard data endpoint
app.get('/api/analytics', (req, res) => {
  const times = analytics.responseTimes;
  const avgMs = times.length ? Math.round(times.reduce((a, b) => a + b, 0) / times.length) : 0;
  const p95Ms = times.length ? [...times].sort((a, b) => a - b)[Math.floor(times.length * 0.95)] : 0;

  res.json({
    keyConfigured: KEY_CONFIGURED,
    startedAt: analytics.startedAt,
    totalRequests: analytics.totalRequests,
    totalErrors: analytics.totalErrors,
    successRate: analytics.totalRequests
      ? Math.round(((analytics.totalRequests - analytics.totalErrors) / analytics.totalRequests) * 100)
      : 100,
    totalTokensEstimate: analytics.totalTokensEstimate,
    avgResponseMs: avgMs,
    p95ResponseMs: p95Ms,
    sentimentCounts: analytics.sentimentCounts,
    requestsByHour: analytics.requestsByHour,
    log: analytics.log,
  });
});

// ---------------------------------------------
// Process-level safety nets
// These prevent an unexpected error anywhere in
// the app from silently killing the whole server.
// ---------------------------------------------
process.on('unhandledRejection', (reason) => {
  console.error('⚠️  Unhandled promise rejection:', reason);
});
process.on('uncaughtException', (err) => {
  console.error('⚠️  Uncaught exception:', err.message);
});

// ---------------------------------------------
// Start server
// ---------------------------------------------
app.listen(PORT, () => {
  console.log(`\n✅ NeuralChat server running at http://localhost:${PORT}`);
  console.log(`   Dashboard: http://localhost:${PORT}/dashboard.html`);
  if (KEY_CONFIGURED) {
    console.log('   Gemini API key loaded — visitors can chat immediately.\n');
  } else {
    console.log('   ⚠️  No Gemini API key yet — chat will return a friendly error until you add one.\n');
  }
});
