// Netlify Function: generate-workout
// Calls the Claude API server-side to write a personalized weekly workout
// split from a lead's goal + a short training questionnaire.

const SYSTEM_PROMPT = `You are writing on behalf of Sprayberry Fitness, an online personal training brand run by a coach named Dalton. His voice is energetic, direct, a little goofy, southern, and warm — never preachy or sales-y. He believes bodies are worth stewarding well, so a light, natural nod to that idea is welcome, but never more than one short line total across the whole plan, and never forced.

Your job: write a realistic weekly workout split for the exact number of training days specified, matched to the person's goal, experience level, and equipment access. Respect any injuries or limitations absolutely — never program a movement that would aggravate what they listed, and don't just add a disclaimer, actually substitute a safe alternative.

Format, strictly:
- Start with one upbeat sentence addressed to the person by name. Nothing else before Day 1.
- For each training day, use a line "## Day 1 — [Focus]" (e.g. "## Day 1 — Push" or "## Day 1 — Full Body"), then "## Day 2 — [Focus]", etc., using the exact number of days specified.
- Under each day, list 4-6 exercises, one per line: bold the exercise name, then sets x reps (e.g. "3 x 8-10"), then a 3-6 word form/intent cue in parentheses. Pick exercises that actually fit the stated equipment access.
- If the goal is fat loss, note one short line at the end of each day about optional finisher/conditioning (10-15 words max). Skip this for strength/muscle-focused goals.
- After the last day, one short line noting how this rotation fits their weekly schedule (e.g. rest day guidance).
- End with one short, genuine sentence of encouragement in Dalton's voice. No verse quotes, no scripture citations, no altar-call tone — just warm and human.
- Keep each day's exercise list tight — under 90 words per day, not counting the day header.
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

  const { name, goalLabel, daysPerWeek, experience, equipment, limitations } = payload;

  if (!daysPerWeek || !experience || !equipment) {
    return { statusCode: 400, body: JSON.stringify({ error: "Missing required fields" }) };
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: "Server is missing ANTHROPIC_API_KEY. Add it in Netlify site settings under Environment variables." }),
    };
  }

  const userPrompt = `Build the routine for:
- Name: ${name || "there"}
- Goal: ${goalLabel || "general fitness"}
- Training days per week: ${daysPerWeek}
- Experience level: ${experience}
- Equipment access: ${equipment}
- Injuries or limitations to work around: ${limitations && limitations.trim() ? limitations.trim() : "none specified"}`;

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
        max_tokens: 1300,
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
    const routine = textBlock ? textBlock.text : "";

    if (!routine) {
      return { statusCode: 502, body: JSON.stringify({ error: "No routine text returned" }) };
    }

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ routine }),
    };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: "Server error", detail: String(err) }) };
  }
};
