// Netlify Function: generate-grocery-list
// Takes the full assembled 7-day meal plan text and consolidates it into
// one categorized grocery list. Runs AFTER the meal plan chunks are
// combined client-side, since it needs the full week as context.

const SYSTEM_PROMPT = `You are given a 7-day meal plan written for a fitness client. Extract every distinct food item into ONE consolidated grocery list a person could shop from in one trip.

Format, strictly:
- Group items under these section headers, in this order, using "## SectionName" as its own line: "## Produce", "## Protein", "## Dairy & Eggs", "## Grains & Pantry", "## Other". Skip a section entirely if nothing belongs in it.
- Under each section, one item per line as "- item name" — combine duplicates across the week into one line (e.g. if chicken breast appears on three days, list it once). Add a rough total in parentheses when it's easy to estimate (e.g. "- Chicken breast (~2.5 lbs total)"), otherwise just list the item with no amount.
- No intro sentence, no closing sentence, no commentary — the list starts immediately with the first "## " header.
- Do not add any item not mentioned in the meal plan text. Do not mention that you are an AI.`;

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

  const { mealPlanText } = payload;

  if (!mealPlanText || !mealPlanText.trim()) {
    return { statusCode: 400, body: JSON.stringify({ error: "Missing mealPlanText" }) };
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: "Server is missing ANTHROPIC_API_KEY. Add it in Netlify site settings under Environment variables." }),
    };
  }

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
        max_tokens: 700,
        system: SYSTEM_PROMPT,
        messages: [{ role: "user", content: `Meal plan:\n\n${mealPlanText}` }],
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      return { statusCode: 502, body: JSON.stringify({ error: "Claude API error", detail: errText }) };
    }

    const data = await response.json();
    const textBlock = (data.content || []).find((b) => b.type === "text");
    const groceryList = textBlock ? textBlock.text : "";

    if (!groceryList) {
      return { statusCode: 502, body: JSON.stringify({ error: "No grocery list returned" }) };
    }

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ groceryList }),
    };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: "Server error", detail: String(err) }) };
  }
};
