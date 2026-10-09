// Netlify Function: food-log
// Client food log. A client opens their private link (/log?c=CODE), types what
// they ate or snaps a photo, and Claude estimates calories + macros. Entries are
// saved per client per day in Netlify Blobs and totals are compared to targets.
//
// Config (Netlify env vars, never in this public repo):
//   ANTHROPIC_API_KEY  – already set for the plan generators
//   FOOD_LOG_CLIENTS   – JSON object keyed by each client's private code:
//     {"eli-7k2q": {"name":"Eli","calories":2200,"protein":200,"carbs":200,"fat":70,
//                   "days": {"sat": {"calories":1850,"carbs":115}}}, ...}   ("days" optional)
//   COACH_KEY          – secret for the coach summary (GET /api/food-log?coach=KEY)

import { getStore } from "@netlify/blobs";

const MODEL = "claude-haiku-4-5-20251001";
const MAX_LOGS_PER_DAY = 25;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const json = (status, body) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });

function loadClients() {
  try {
    return JSON.parse(process.env.FOOD_LOG_CLIENTS || "{}");
  } catch {
    return {};
  }
}

const round = (n) => Math.round(Number(n) || 0);

function sumEntries(entries) {
  return entries.reduce(
    (t, e) => ({
      calories: t.calories + e.calories,
      protein: t.protein + e.protein,
      carbs: t.carbs + e.carbs,
      fat: t.fat + e.fat,
    }),
    { calories: 0, protein: 0, carbs: 0, fat: 0 }
  );
}

function shiftDate(date, days) {
  const d = new Date(date + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

async function readDay(store, code, date) {
  return (await store.get(`log/${code}/${date}`, { type: "json" })) || [];
}

async function lastNDays(store, code, date, n) {
  const days = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = shiftDate(date, -i);
    const entries = await readDay(store, code, d);
    days.push({ date: d, meals: entries.length, ...sumEntries(entries) });
  }
  return days;
}

// Optional per-weekday overrides, e.g. "days": {"sat": {"calories": 1850, "carbs": 115}}
const WEEKDAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
const publicTargets = (c, date) => {
  const wd = date ? WEEKDAYS[new Date(date + "T12:00:00Z").getUTCDay()] : null;
  const t = { ...c, ...((wd && c.days && c.days[wd]) || {}) };
  return {
    calories: t.calories || null,
    protein: t.protein || null,
    carbs: t.carbs || null,
    fat: t.fat || null,
  };
};

async function dayPayload(store, code, client, date) {
  const entries = await readDay(store, code, date);
  return {
    name: client.name,
    date,
    targets: publicTargets(client, date),
    entries,
    totals: sumEntries(entries),
    week: await lastNDays(store, code, date, 7),
  };
}

// ---- Claude estimate -------------------------------------------------------

const SYSTEM_PROMPT = `You estimate calories and macros for meals logged by clients of Sprayberry Fitness, an online coaching business. Be a realistic, practical nutrition coach.

Rules:
- Break the meal into its main items. Use the portions the client gives; if none are given, assume a typical adult portion and say what you assumed in "portion".
- For photos, judge portion size from the plate, utensils and packaging. Read nutrition labels if visible.
- Account for cooking oils, butter, sauces and dressings when they are likely, since these are the most commonly missed calories.
- Restaurant and fast-food items: use the chain's published numbers when you know them.
- Calories should roughly equal protein*4 + carbs*4 + fat*9.
- "note": one short, friendly coaching line (max 20 words) — e.g. a protein nudge or what would make the estimate more accurate. No lectures.
- If the input is not food at all, return an empty items list and explain in "note".`;

const TOOL = {
  name: "log_meal",
  description: "Record the estimated nutrition for the meal.",
  input_schema: {
    type: "object",
    properties: {
      title: { type: "string", description: "Short meal name, max 6 words, e.g. 'Chicken burrito bowl'" },
      items: {
        type: "array",
        items: {
          type: "object",
          properties: {
            name: { type: "string" },
            portion: { type: "string", description: "e.g. '6 oz cooked', '1 cup', '2 large'" },
            calories: { type: "number" },
            protein_g: { type: "number" },
            carbs_g: { type: "number" },
            fat_g: { type: "number" },
          },
          required: ["name", "portion", "calories", "protein_g", "carbs_g", "fat_g"],
        },
      },
      confidence: { type: "string", enum: ["high", "medium", "low"] },
      note: { type: "string" },
    },
    required: ["title", "items", "confidence", "note"],
  },
};

async function estimate({ text, image, apiKey }) {
  const content = [];
  if (image) {
    const m = /^data:(image\/(?:jpeg|png|webp|gif));base64,(.+)$/.exec(image);
    if (!m) throw new Error("Unsupported image format");
    content.push({ type: "image", source: { type: "base64", media_type: m[1], data: m[2] } });
  }
  content.push({
    type: "text",
    text: text ? `What I ate: ${text}` : "Estimate the meal in this photo.",
  });

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 1000,
      system: SYSTEM_PROMPT,
      tools: [TOOL],
      tool_choice: { type: "tool", name: "log_meal" },
      messages: [{ role: "user", content }],
    }),
  });
  if (!res.ok) throw new Error(`Claude API error ${res.status}: ${await res.text()}`);
  const data = await res.json();
  const block = (data.content || []).find((b) => b.type === "tool_use");
  if (!block) throw new Error("No estimate returned");
  return block.input;
}

// ---- Handler ---------------------------------------------------------------

export default async (req) => {
  const url = new URL(req.url);
  const store = getStore({ name: "food-log", consistency: "strong" });
  const clients = loadClients();

  // Coach summary: every client's last 7 days.
  if (req.method === "GET" && url.searchParams.get("coach")) {
    const key = process.env.COACH_KEY;
    if (!key || url.searchParams.get("coach") !== key) return json(401, { error: "Not authorized" });
    const date = url.searchParams.get("date");
    const day = DATE_RE.test(date || "") ? date : new Date().toISOString().slice(0, 10);
    const out = [];
    for (const [code, c] of Object.entries(clients)) {
      out.push({ name: c.name, targets: publicTargets(c, day), week: await lastNDays(store, code, day, 7), today: await readDay(store, code, day) });
    }
    return json(200, { date: day, clients: out });
  }

  let body = {};
  if (req.method === "POST" || req.method === "DELETE") {
    try {
      body = await req.json();
    } catch {
      return json(400, { error: "Invalid JSON body" });
    }
  }

  const code = (url.searchParams.get("c") || body.c || "").trim().toLowerCase();
  const client = clients[code];
  if (!client) return json(404, { error: "This link isn't active. Text Dalton for your log link." });

  const date = url.searchParams.get("date") || body.date;
  if (!DATE_RE.test(date || "")) return json(400, { error: "Missing or invalid date" });

  if (req.method === "GET") return json(200, await dayPayload(store, code, client, date));

  if (req.method === "DELETE") {
    const entries = await readDay(store, code, date);
    const kept = entries.filter((e) => e.id !== body.id);
    await store.setJSON(`log/${code}/${date}`, kept);
    return json(200, await dayPayload(store, code, client, date));
  }

  if (req.method !== "POST") return json(405, { error: "Method not allowed" });

  const text = String(body.text || "").trim().slice(0, 1000);
  const image = typeof body.image === "string" ? body.image : "";
  if (!text && !image) return json(400, { error: "Type what you ate or add a photo." });
  if (image.length > 5_000_000) return json(413, { error: "That photo is too large. Try again." });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return json(500, { error: "Server is missing ANTHROPIC_API_KEY." });

  const existing = await readDay(store, code, date);
  if (existing.length >= MAX_LOGS_PER_DAY) return json(429, { error: "That's the max logs for one day." });

  let est;
  try {
    est = await estimate({ text, image, apiKey });
  } catch (e) {
    return json(502, { error: "Couldn't estimate that one. Try again in a moment.", detail: String(e.message || e) });
  }

  const items = (est.items || []).map((i) => ({
    name: String(i.name),
    portion: String(i.portion || ""),
    calories: round(i.calories),
    protein: round(i.protein_g),
    carbs: round(i.carbs_g),
    fat: round(i.fat_g),
  }));
  if (!items.length) return json(422, { error: est.note || "That doesn't look like food. Try describing it." });

  const entry = {
    id: crypto.randomUUID(),
    at: new Date().toISOString(),
    meal: ["Breakfast", "Lunch", "Dinner", "Snack"].includes(body.meal) ? body.meal : "Meal",
    title: String(est.title || "Meal").slice(0, 60),
    input: text,
    photo: Boolean(image),
    items,
    ...sumEntries(items),
    confidence: est.confidence,
    note: String(est.note || ""),
  };

  // Re-read right before writing so a quick second log isn't lost.
  const latest = await readDay(store, code, date);
  await store.setJSON(`log/${code}/${date}`, [...latest, entry]);

  return json(200, { entry, ...(await dayPayload(store, code, client, date)) });
};

export const config = {
  path: "/api/food-log",
};
