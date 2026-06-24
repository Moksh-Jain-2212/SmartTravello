import prisma from "../config/db.js";
import fetch from "node-fetch";
import { runMCPOrchestrator } from "./orchestrator.js";
import { generateGroqText } from "../config/groq.js";

const MONTHS = {
  january: 0,
  february: 1,
  march: 2,
  april: 3,
  may: 4,
  june: 5,
  july: 6,
  august: 7,
  september: 8,
  october: 9,
  november: 10,
  december: 11,
};

const WEEKDAYS = {
  sunday: 0,
  monday: 1,
  tuesday: 2,
  wednesday: 3,
  thursday: 4,
  friday: 5,
  saturday: 6,
};

function formatDate(date) {
  return date.toISOString().split("T")[0];
}

function addDays(date, days) {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function futureDate(year, month, day) {
  const today = new Date();
  const current = new Date(
    Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate())
  );
  let candidate = new Date(Date.UTC(year, month, day));

  if (candidate < current) {
    candidate = new Date(Date.UTC(year + 1, month, day));
  }

  return candidate;
}

function titleCaseLocation(value) {
  return value
    .replace(/\b(starting|leaving|for|with|budget|from|to|in|on|next|this)\b.*$/i, "")
    .replace(/[.,]/g, "")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(" ");
}

function extractLocation(prompt, patterns) {
  for (const pattern of patterns) {
    const match = prompt.match(pattern);
    if (match?.[1]) {
      const location = titleCaseLocation(match[1]);
      if (location) return location;
    }
  }

  return "Unknown";
}

function parseFallbackDate(prompt) {
  const today = new Date();
  const current = new Date(
    Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate())
  );
  const lowerPrompt = prompt.toLowerCase();

  const isoMatch = lowerPrompt.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  if (isoMatch) {
    return new Date(Date.UTC(Number(isoMatch[1]), Number(isoMatch[2]) - 1, Number(isoMatch[3])));
  }

  const monthNames = Object.keys(MONTHS).join("|");
  const monthDayMatch = lowerPrompt.match(
    new RegExp(`\\b(${monthNames})\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s*(\\d{4}))?\\b`, "i")
  );
  if (monthDayMatch) {
    const month = MONTHS[monthDayMatch[1].toLowerCase()];
    const day = Number(monthDayMatch[2]);
    const year = monthDayMatch[3] ? Number(monthDayMatch[3]) : today.getUTCFullYear();
    return futureDate(year, month, day);
  }

  if (lowerPrompt.includes("next week")) {
    return addDays(current, 7);
  }

  const weekdayMatch = lowerPrompt.match(
    /\b(this|next)?\s*(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/i
  );
  if (weekdayMatch) {
    const modifier = weekdayMatch[1]?.toLowerCase();
    const targetDay = WEEKDAYS[weekdayMatch[2].toLowerCase()];
    let daysUntil = (targetDay - current.getUTCDay() + 7) % 7;

    if (modifier === "next") daysUntil += 7;
    if (modifier === "this" && daysUntil === 0) daysUntil = 7;

    return addDays(current, daysUntil);
  }

  const monthOnlyMatch = lowerPrompt.match(new RegExp(`\\bin\\s+(${monthNames})(?:\\s+(\\d{4}))?\\b`, "i"));
  if (monthOnlyMatch) {
    const month = MONTHS[monthOnlyMatch[1].toLowerCase()];
    const year = monthOnlyMatch[2] ? Number(monthOnlyMatch[2]) : today.getUTCFullYear();
    return futureDate(year, month, 1);
  }

  return current;
}

function parsePromptWithFallback(prompt) {
  const durationMatch = prompt.match(/(\d+)\s*-\s*day/i) || prompt.match(/(\d+)\s+days?/i);
  const durationDays = durationMatch ? Number(durationMatch[1]) : /weekend/i.test(prompt) ? 2 : 3;
  const startDate = parseFallbackDate(prompt);
  const endDate = addDays(startDate, durationDays);
  const adultsMatch = prompt.match(/(\d+)\s*(adults?|people|persons?|travelers?|travellers?)/i);
  const budgetMatch =
    prompt.match(/(?:budget(?:\s+of)?|with\s+a\s+budget\s+of|under)\s*(?:\$|₹|rs\.?|inr)?\s*([\d,]+(?:\.\d+)?)/i) ||
    prompt.match(/(?:\$|₹)\s*([\d,]+(?:\.\d+)?)/);

  const destination = extractLocation(prompt, [
    /\b(?:trip|getaway|visit|travel|go|going)\s+to\s+([a-zA-Z\s]+?)(?=\s+from\b|\s+starting\b|\s+leaving\b|\s+for\b|\s+with\b|,|$)/i,
    /\bto\s+([a-zA-Z\s]+?)(?=\s+from\b|\s+starting\b|\s+leaving\b|\s+for\b|\s+with\b|,|$)/i,
  ]);
  const origin = extractLocation(prompt, [
    /\bfrom\s+([a-zA-Z\s]+?)(?=\s+starting\b|\s+leaving\b|\s+for\b|\s+with\b|\s+budget\b|,|$)/i,
  ]);

  return {
    title: destination === "Unknown" ? "New Trip" : `Trip to ${destination}`,
    origin,
    destination,
    start_date: formatDate(startDate),
    end_date: formatDate(endDate),
    adults: adultsMatch ? Number(adultsMatch[1]) : 1,
    total_budget: budgetMatch ? Number(budgetMatch[1].replace(/,/g, "")) : 0,
    status: "planned",
    parsed_by: "fallback",
  };
}

function parseIsoDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || "")) {
    return null;
  }

  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return Number.isNaN(date.getTime()) ? null : date;
}

function normalizeFutureDateRange(startDateValue, endDateValue) {
  const today = new Date();
  const current = new Date(
    Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate())
  );
  let startDate = parseIsoDate(startDateValue) || current;
  let endDate = parseIsoDate(endDateValue) || addDays(startDate, 3);
  const durationDays = Math.max(
    1,
    Math.ceil((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24)) || 1
  );

  while (startDate < current) {
    startDate = new Date(
      Date.UTC(startDate.getUTCFullYear() + 1, startDate.getUTCMonth(), startDate.getUTCDate())
    );
  }

  endDate = addDays(startDate, durationDays);

  return {
    start_date: formatDate(startDate),
    end_date: formatDate(endDate),
  };
}

// --------------------
// Fetch coordinates from Geoapify
// --------------------
async function getCoordinatesGeoapify(location) {
  try {
    const apiKey = process.env.GEOAPIFY_API_KEY;
    const url = `https://api.geoapify.com/v1/geocode/search?text=${encodeURIComponent(
      location
    )}&apiKey=${apiKey}`;

    const res = await fetch(url);
    const data = await res.json();

    const feature = data.features?.[0];
    if (feature?.geometry?.coordinates) {
      const [lon, lat] = feature.geometry.coordinates;
      return { lat, lng: lon };
    }

    console.warn(`No coordinates found for ${location}, using fallback.`);
    return { lat: 0, lng: 0 };
  } catch (err) {
    console.error(`Geoapify fetch failed for ${location}:`, err);
    return { lat: 0, lng: 0 };
  }
}

// --------------------
// Parse user prompt using Groq
// --------------------
async function parsePromptWithGroq(prompt) {
  const systemPrompt = `
You are a travel assistant. Parse the user prompt into JSON with these fields:
{
  "title": string,
  "origin": string,
  "destination": string,
  "start_date": "YYYY-MM-DD",
  "end_date": "YYYY-MM-DD",
  "adults": number,
  "total_budget": number,
  "status": string
}

Rules:
- Return ONLY valid JSON, no explanations.
- Dates must be in YYYY-MM-DD format.
- Extract origin and destination correctly.
- Use reasonable defaults if any field is missing.
`;

  try {
    const text = await generateGroqText({
      temperature: 0,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: prompt },
      ],
    });

    if (!text) throw new Error("Groq returned empty response");

    const cleaned = text.replace(/```json|```/gi, "").trim();
    return JSON.parse(cleaned);
  } catch (err) {
    console.warn(`Groq prompt parsing failed; using fallback parser: ${err.message}`);
    return parsePromptWithFallback(prompt);
  }
}

// --------------------
// Main trip creation + orchestrator
// --------------------
export async function createTripAndRunOrchestrator({ userId, prompt }) {
  // 1️⃣ Parse prompt
  const tripDataRaw = await parsePromptWithGroq(prompt);

  // 2️⃣ Normalize city names
  const normalizeLocation = (name) => {
    const mapping = { Bombay: "Mumbai", Calcutta: "Kolkata" };
    return mapping[name] || name || "Unknown";
  };

  // 3️⃣ Normalize and set defaults
  const normalizedDates = normalizeFutureDateRange(tripDataRaw.start_date, tripDataRaw.end_date);
  const tripData = {
    title: tripDataRaw.title || `Trip to ${tripDataRaw.destination || "Unknown"}`,
    origin: tripDataRaw.origin || "Unknown",
    destination: tripDataRaw.destination || "Unknown",
    start_date: normalizedDates.start_date,
    end_date: normalizedDates.end_date,
    adults: typeof tripDataRaw.adults === "number" ? tripDataRaw.adults : 1,
    total_budget: typeof tripDataRaw.total_budget === "number" ? tripDataRaw.total_budget : 0,
    status: tripDataRaw.status || "planned",
  };

  console.log("=== Debug: Normalized tripData ===");
  console.log(tripData);

  // 4️⃣ Fetch coordinates in parallel
  const [origin_coords, destination_coords] = await Promise.all([
    getCoordinatesGeoapify(normalizeLocation(tripData.origin)),
    getCoordinatesGeoapify(normalizeLocation(tripData.destination)),
  ]);

  console.log("=== Debug: Coordinates ===");
  console.log("Origin coords:", origin_coords);
  console.log("Destination coords:", destination_coords);

  // 5️⃣ Create trip in DB
  const trip = await prisma.trip.create({
    data: {
      user_id: userId,
      title: tripData.title,
      origin: tripData.origin,
      origin_coords,
      destination: tripData.destination,
      destination_coords,
      start_date: new Date(tripData.start_date),
      end_date: new Date(tripData.end_date),
      adults: tripData.adults,
      status: tripData.status,
      total_budget: tripData.total_budget,
      summary: {
        ...tripDataRaw,
        ...tripData,
      }
    },
  });

  console.log("=== Debug: Trip object before orchestrator ===");
  console.log(trip);

  const orchestratorResult = await runMCPOrchestrator(trip)

  return {
    tripId: trip.id,
    title: trip.title,
    origin: trip.origin,
    destination: trip.destination,
    origin_coords: trip.origin_coords,
    destination_coords: trip.destination_coords,
    start_date: trip.start_date,
    end_date: trip.end_date,
    adults: trip.adults,
    total_budget: trip.total_budget,
    status: orchestratorResult.status,
    orchestratorSummary: orchestratorResult.answer,
    toolResults: orchestratorResult.toolResults,
  };
}
