import { generateGroqText } from "../config/groq.js";

function normalizeHistory(history) {
  if (!Array.isArray(history)) return [];

  return history
    .slice(-8)
    .map((message) => {
      const role = message.role === "user" ? "user" : "assistant";
      const content = typeof message.text === "string" ? message.text.trim() : "";
      return content ? { role, content } : null;
    })
    .filter(Boolean);
}

export async function chatWithAssistant(req, res) {
  const { message, history = [] } = req.body;

  if (!message || typeof message !== "string") {
    return res.status(400).json({ error: "message is required" });
  }

  try {
    const text = await generateGroqText({
      temperature: 0.4,
      messages: [
        {
          role: "system",
          content:
            "You are SmartTravello's friendly travel planning assistant. Be concise, practical, and useful for itineraries, destinations, budgets, routes, packing, and travel timing.",
        },
        ...normalizeHistory(history),
        { role: "user", content: message.trim() },
      ],
    });

    res.json({
      text: text || "Sorry, I couldn't generate a useful response right now.",
      sources: [],
    });
  } catch (error) {
    console.error("SmartTravello chat failed:", error);
    res.status(500).json({ error: "AI chat failed. Please try again later." });
  }
}
