// Ask-for-a-movie helper for Cory's Plex Hub.
//
// POST /api/recommend  { ask: "something funny with dogs", liked: ["Enchanted"] }
//   -> { picks: [{ title, year, type: "movie"|"tv", why }], note }
// GET  /api/recommend  -> { ready: true|false }   (is the helper switched on?)
//
// Only approved people can use it: the request carries a Firebase ID token,
// we verify it against Google's keys, then read the caller's own users/{uid}
// doc through Firestore's REST API with that same token (the rules let a
// person read their own doc) and require role user or admin.
//
// Provider: set ONE of these in Vercel's environment variables.
//   DEEPSEEK_API_KEY   -> DeepSeek (deepseek-chat), OpenAI-style API, cheapest
//   ANTHROPIC_API_KEY  -> Claude Haiku 4.5
// Either way a call is ~700 input + 400 output tokens, a fraction of a cent;
// a family of ten asking daily stays around a dollar a month or less.

import Anthropic from "@anthropic-ai/sdk";
import { createRemoteJWKSet, jwtVerify } from "jose";

const PROJECT_ID = "plexmovies-530e4";
const CLAUDE_MODEL = "claude-haiku-4-5";
const DEEPSEEK_MODEL = "deepseek-chat";
const DEEPSEEK_URL = "https://api.deepseek.com/chat/completions";
const JWKS = createRemoteJWKSet(
  new URL("https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com"),
);

const SYSTEM = `You help one family pick something to watch on their home Plex server. The person asking may be older and not technical, so keep every "why" to one plain, warm sentence with no jargon and no spoilers.

Reply with JSON only, no prose around it, in exactly this shape:
{"picks":[{"title":"...","year":2004,"type":"movie","why":"..."}],"note":"one short friendly sentence"}

Rules:
- Give 6 picks. Mix well-known titles with a couple of less obvious ones. Movies unless they clearly ask for shows; "type" is "movie" or "tv".
- Use the exact release title and the correct year so the titles can be looked up.
- Never repeat a title they said they already liked or watched; use those only as taste hints.
- If the ask is not about what to watch, still answer with 6 picks that fit the mood you can infer, and say so in "note".
- No markdown, no emojis.`;

// Per-instance rate limit; good enough for a family site.
const calls = new Map();
function allow(uid, limit = 40, windowMs = 60 * 60 * 1000) {
  const now = Date.now();
  const recent = (calls.get(uid) || []).filter((t) => now - t < windowMs);
  if (recent.length >= limit) return false;
  recent.push(now);
  calls.set(uid, recent);
  return true;
}

async function verifyCaller(req) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!token) return { error: "Sign in first.", status: 401 };
  let payload;
  try {
    ({ payload } = await jwtVerify(token, JWKS, {
      issuer: `https://securetoken.google.com/${PROJECT_ID}`,
      audience: PROJECT_ID,
    }));
  } catch {
    return { error: "Your sign-in expired. Reload the page and try again.", status: 401 };
  }
  const uid = String(payload.sub || payload.user_id || "");
  if (!uid) return { error: "Sign in first.", status: 401 };

  const docUrl = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents/users/${encodeURIComponent(uid)}`;
  const r = await fetch(docUrl, { headers: { Authorization: `Bearer ${token}` } });
  if (!r.ok) return { error: "Could not check your access. Try again in a minute.", status: 403 };
  const data = await r.json();
  const role = data?.fields?.role?.stringValue || "";
  if (role !== "user" && role !== "admin") {
    return { error: "This helper unlocks once Cory approves your access.", status: 403 };
  }
  return { uid, role, name: data?.fields?.displayName?.stringValue || "" };
}

function parsePicks(text) {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end < 0) throw new Error("no json");
  const obj = JSON.parse(text.slice(start, end + 1));
  const picks = (Array.isArray(obj.picks) ? obj.picks : [])
    .map((p) => ({
      title: String(p.title || "").trim().slice(0, 120),
      year: Number.parseInt(p.year, 10) || null,
      type: p.type === "tv" ? "tv" : "movie",
      why: String(p.why || "").trim().slice(0, 240),
    }))
    .filter((p) => p.title)
    .slice(0, 8);
  return { picks, note: String(obj.note || "").trim().slice(0, 200) };
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  const provider = process.env.DEEPSEEK_API_KEY ? "deepseek" : process.env.ANTHROPIC_API_KEY ? "claude" : "";
  const ready = Boolean(provider);

  if (req.method === "GET") {
    return res.status(200).json({ ready, provider });
  }
  if (req.method !== "POST") {
    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({ error: "Use POST." });
  }
  if (!ready) {
    return res.status(503).json({ error: "The helper is not switched on yet. Cory needs to add the API key." });
  }

  const caller = await verifyCaller(req);
  if (caller.error) return res.status(caller.status).json({ error: caller.error });
  if (!allow(caller.uid)) {
    return res.status(429).json({ error: "That is a lot of asking for one hour. Try again a little later." });
  }

  const body = typeof req.body === "string" ? safeJson(req.body) : req.body || {};
  const ask = String(body.ask || "").trim().slice(0, 300);
  const liked = (Array.isArray(body.liked) ? body.liked : []).map((t) => String(t).slice(0, 80)).slice(0, 12);
  if (ask.length < 2) return res.status(400).json({ error: "Tell me a little about what you feel like watching." });

  const userText = [
    `Ask: ${ask}`,
    liked.length ? `They already liked or requested: ${liked.join("; ")}` : "",
    caller.name ? `Their first name: ${caller.name.split(" ")[0]}` : "",
  ].filter(Boolean).join("\n");

  let text = "";
  try {
    text = provider === "deepseek" ? await askDeepSeek(userText) : await askClaude(userText);
  } catch (err) {
    const status = err?.status || 502;
    const msg = status === 429 ? "The helper is busy right now. Try again in a minute."
      : status === 401 ? "The helper's key is not working. Tell Cory."
      : "The helper could not answer just now. Try again in a minute.";
    return res.status(502).json({ error: msg });
  }

  try {
    return res.status(200).json(parsePicks(text));
  } catch {
    return res.status(502).json({ error: "The helper answered in a way I could not read. Try asking differently." });
  }
}

function safeJson(s) {
  try { return JSON.parse(s); } catch { return {}; }
}

async function askClaude(userText) {
  const client = new Anthropic();
  const message = await client.messages.create({
    model: CLAUDE_MODEL,
    max_tokens: 1024,
    system: SYSTEM,
    messages: [{ role: "user", content: userText }],
  });
  return message.content.filter((b) => b.type === "text").map((b) => b.text).join("\n");
}

async function askDeepSeek(userText) {
  const r = await fetch(DEEPSEEK_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.DEEPSEEK_API_KEY}` },
    body: JSON.stringify({
      model: DEEPSEEK_MODEL,
      max_tokens: 1024,
      temperature: 0.8,
      response_format: { type: "json_object" },
      messages: [{ role: "system", content: SYSTEM }, { role: "user", content: userText }],
    }),
  });
  if (!r.ok) {
    const err = new Error(`deepseek ${r.status}`);
    err.status = r.status;
    throw err;
  }
  const data = await r.json();
  return data?.choices?.[0]?.message?.content || "";
}
