import "dotenv/config";
import OpenAI from "openai";

const GROQ_BASE_URL = "https://api.groq.com/openai/v1";
const DEFAULT_GROQ_MODEL = "llama-3.3-70b-versatile";

let client;
let clientApiKey;

function getGroqClient() {
  const apiKey = process.env.GROQ_API_KEY;

  if (!apiKey) {
    throw new Error("GROQ_API_KEY is not set");
  }

  if (!client || clientApiKey !== apiKey) {
    client = new OpenAI({
      apiKey,
      baseURL: GROQ_BASE_URL,
    });
    clientApiKey = apiKey;
  }

  return client;
}

export function getGroqModel() {
  return process.env.GROQ_MODEL?.trim() || DEFAULT_GROQ_MODEL;
}

export async function generateGroqText({
  messages,
  model = getGroqModel(),
  temperature = 0.3,
}) {
  const completion = await getGroqClient().chat.completions.create({
    model,
    messages,
    temperature,
  });

  return completion.choices?.[0]?.message?.content?.trim() || "";
}
