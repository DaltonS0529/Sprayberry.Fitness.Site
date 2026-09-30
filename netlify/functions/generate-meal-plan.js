// Netlify Function: generate-meal-plan
// Generates a CHUNK of a 7-day meal plan (e.g. days 1-4, or days 5-7).
// Called twice in parallel from the client so the whole week stays
// well under the function timeout. Protein assignment per day is computed
// client-side and passed in, so the two parallel chunks never repeat
// the same protein emphasis on the same day.

const SYSTEM_PROMPT = `You are writing on behalf of Sprayberry Fitness, an online personal training brand run by a coach named Dalton. His voice is energetic, direct, a little goofy, southern, and warm — never preachy or sales-y. He believes bodies are worth stewarding well, so a light, natural nod to that idea is welcome, but never more than one short line total, and never forced.

Your job: write REALISTIC, SPECIFIC daily meal plans for the exact days listed, each hitting the person's calorie and macro targets as closely as reasonably possible, using real whole foods and real portion sizes (ounces, cups, grams). Respect every dietary restriction and disliked food absolutely — never include them, not even as a "substitute if needed" mention.

Each day has an assigned primary protein category (given to you below) — build that day's meals around it, using specific, varied foods within that category (don't repeat the exact same food across days even within the same category — e.g. if two days both say "chicken/lean meats," pick different cuts or preparations).

Format, strictly:
- No greeting, no intro sentence — start directly with the first day header. (This is one chunk of a larger week; the greeting is added elsewhere.)
- For each day, use a line "## Day N" (matching the day numbers given to you exactly) as its own line.
- Under each day, one line per meal: bold the meal name, then the foods with portions, then approximate calories in parentheses. Use the exact number of meals/snacks specified.
- End each day with one line: "Day total: ~X calories" (approximate is fine).
- Keep each day's meal list tight — under 95 words per day, not counting the day header or day total line.
- Do not add disclaimers, do not mention that you are an AI, do not add nutrition advice caveats, do not add any closing/summary text after the last day in this chunk.`;

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

  const {
    calories,
    protein,
    carbs,
    fat,
    mealsPerDay,
    restriction,
    dislikes,
    days, // array like [{ day: 1, protein: "chicken/lean meats" }, ...]
  } = payload;

  if (!calories || !protein || !carbs || !fat || !days || !days.length) {
    return { statusCode: 400, body: JSON.stringify({ error: "Missing required fields" }) };
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: "Server is missing ANTHROPIC_API_KEY. Add it in Netlify site settings under Environment variables." }),
    };
  }

  const dayList = days.map((d) => `Day ${d.day}: primary protein = ${d.protein}`).join("\n");

  const userPrompt = `Build these days:
${dayList}

Shared targets for every day:
- Daily calorie target: ${calories} calories
- Protein target: ${protein}g
- Carb target: ${carbs}g
- Fat target: ${fat}g
- Meals/snacks per day: ${mealsPerDay || 4}
- Dietary restriction: ${restriction && restriction !== "none" ? restriction : "none"}
- Foods to avoid: ${dislikes && dislikes.trim() ? dislikes.trim() : "none specified"}`;

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
        max_tokens: 1100,
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
    const chunk = textBlock ? textBlock.text : "";

    if (!chunk) {
      return { statusCode: 502, body: JSON.stringify({ error: "No plan text returned" }) };
    }

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chunk }),
    };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: "Server error", detail: String(err) }) };
  }
};
