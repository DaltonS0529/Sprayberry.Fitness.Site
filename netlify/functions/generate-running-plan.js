// Netlify Function: generate-running-plan
// Calls the Claude API server-side to write a personalized multi-week running
// plan from a lead's running goal, current level, schedule and limitations.

const SYSTEM_PROMPT = `You are writing on behalf of Sprayberry Fitness, an online personal training brand run by a coach named Dalton, a former college track athlete. His voice is energetic, direct, a little goofy, southern, and warm — never preachy or sales-y. He believes bodies are worth stewarding well, so a light, natural nod to that idea is welcome, but never more than one short line total across the whole plan, and never forced.

Your job: write a realistic, progressive running plan for the exact number of weeks and runs per week specified, matched to the person's running goal and current level. Build volume gradually (no more than roughly 10% more weekly running time or distance week to week), include an easier recovery week every 3-4 weeks on plans of 6+ weeks, and taper the final week if the goal is a race. Beginners and people who can't yet run continuously get run/walk intervals. Respect any injuries or limitations absolutely — reduce impact or substitute cross-training rather than just adding a disclaimer.

If they also lift (strength days per week given), keep hard runs off heavy leg days and note in one line how to pair runs with lifting.

Format, strictly:
- Start with one upbeat sentence addressed to the person by name. Nothing else before Week 1.
- One short line explaining effort levels: Easy = conversational pace; Tempo = comfortably hard; Intervals = hard with recovery jogs.
- For each week, use a line "## Week 1 — [Focus]" (e.g. "## Week 1 — Build the base"), then "## Week 2 — [Focus]", etc., for the exact number of weeks given.
- Under each week, list exactly the number of runs per week given, one per line starting with "- ": bold the run name (e.g. **Run 1 · Easy**), then the workout in time or miles with any intervals spelled out (e.g. "6 x 2 min hard / 2 min easy jog"), keeping each line under 22 words.
- Optionally one line per week starting "- **Extra:**" for cross-training, mobility or strides (keep it short).
- After the last week, one short line on what to do next (e.g. race day tip or how to keep building).
- End with one short, genuine sentence of encouragement in Dalton's voice. No verse quotes, no scripture citations, no altar-call tone — just warm and human.
- Do not add disclaimers, do not mention that you are an AI, do not add "consult a doctor" caveats beyond what's needed to respect a stated injury.`;

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: JSON.stringify({ error: "Method not allowed" }) };
  }

  let payload;
  try {
    payload = JSON.parse(event.body || "{}");
  } catch (e) {
    return { statusCode: 400, body: JSON.stringify({ error: "Invalid JSON body" }) };
  }

  const { name, runGoal, runLevel, runsPerWeek, weeks, weeklyMiles, raceDate, liftDays, limitations } = payload;

  if (!runGoal || !runLevel || !runsPerWeek || !weeks) {
    return { statusCode: 400, body: JSON.stringify({ error: "Missing required fields" }) };
  }

  const weeksNum = Math.min(Math.max(parseInt(weeks, 10) || 6, 4), 8);
  const runsNum = Math.min(Math.max(parseInt(runsPerWeek, 10) || 3, 2), 5);

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: "Server is missing ANTHROPIC_API_KEY. Add it in Netlify site settings under Environment variables." }),
    };
  }

  const clean = (v, fallback) => (v && String(v).trim() ? String(v).trim().slice(0, 200) : fallback);

  const userPrompt = `Build the running plan for:
- Name: ${clean(name, "there")}
- Running goal: ${clean(runGoal, "general endurance")}
- Current running level: ${clean(runLevel, "beginner")}
- Current weekly mileage: ${clean(weeklyMiles, "not specified")}
- Runs per week: ${runsNum}
- Plan length: ${weeksNum} weeks
- Race date (if any): ${clean(raceDate, "none")}
- Strength training days per week alongside running: ${clean(liftDays, "not specified")}
- Injuries or limitations to work around: ${clean(limitations, "none specified")}`;

  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 1800,
        system: SYSTEM_PROMPT,
        messages: [{ role: "user", content: userPrompt }],
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      return { statusCode: 502, body: JSON.stringify({ error: "Claude API error", detail: errText }) };
    }

    const data = await response.json();
    const textBlock = (data.content || []).find((b) => b.type === "text");
    const plan = textBlock ? textBlock.text : "";

    if (!plan) {
      return { statusCode: 502, body: JSON.stringify({ error: "No running plan text returned" }) };
    }

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ plan }),
    };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: "Server error", detail: String(err) }) };
  }
};
