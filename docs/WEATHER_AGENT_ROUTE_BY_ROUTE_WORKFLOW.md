 # Weather Agent Route-by-Route Workflow

This document explains how `backend/src/agents/weatherAgent.js` fits into the SmartTravello request flow. The weather agent is not exposed as a standalone API endpoint. It runs as part of the full trip-planning orchestrator, stores forecast rows in `WeatherData`, and later routes read that stored data.

## Related Files

| Area | File |
| --- | --- |
| Express app route mounting | `backend/app.js` |
| Agent route | `backend/src/routes/agent.routes.js` |
| Agent controller | `backend/src/controllers/agent.controller.js` |
| Trip creation | `backend/src/agents/tripAgent.js` |
| Orchestrator | `backend/src/agents/orchestrator.js` |
| Weather agent | `backend/src/agents/weatherAgent.js` |
| Trip data routes | `backend/src/routes/trip.routes.js` |
| Trip controller | `backend/src/controllers/trip.controller.js` |
| Prisma schema | `backend/prisma/schema.prisma` |
| New trip page | `frontend/src/app/dashboard/new/page.tsx` |
| Trip overview page | `frontend/src/app/dashboard/trip/[id]/overview/page.tsx` |
| Weather page | `frontend/src/app/dashboard/trip/[id]/weather/page.tsx` |
| Itinerary agent consumer | `backend/src/agents/itineraryAgent.js` |

## Data Model

Weather data is stored in the `WeatherData` Prisma model:

```prisma
model WeatherData {
  id               String   @id @default(auto()) @map("_id") @db.ObjectId
  trip_id          String   @db.ObjectId
  location         String
  date             DateTime
  temperature_high Float
  temperature_low  Float
  conditions       String
  precipitation    Float
  weather_json     Json
  fetched_at       DateTime @default(now())

  trip Trip @relation(fields: [trip_id], references: [id])
}
```

Each forecast day becomes one `WeatherData` document linked to a `Trip` by `trip_id`.

## External Dependency

The weather agent uses SerpApi Google weather search:

```js
getJson({
  engine: "google",
  q: `weather for ${destination}`,
  api_key: process.env.SERPAPI_KEY,
});
```

Required environment variable:

```env
SERPAPI_KEY=<serpapi-key>
```

If `SERPAPI_KEY` is missing, the agent throws before the SerpApi fallback block runs.

## Route 1: Frontend New Trip Page

Frontend route:

```text
/dashboard/new
```

File:

```text
frontend/src/app/dashboard/new/page.tsx
```

Purpose:

This page starts the full trip-planning workflow. It is the normal user-facing entry point that eventually causes `weatherAgent` to run.

Workflow:

1. User enters a natural-language trip prompt.
2. `handleSubmit()` runs when the form is submitted.
3. The frontend reads the JWT from `localStorage`.
4. If no token exists, the user is redirected to `/login`.
5. The frontend sends a request to the backend agent route.

Request:

```http
POST http://localhost:5000/api/agents/run
Authorization: Bearer <jwt>
Content-Type: application/json
```

Request body:

```json
{
  "prompt": "Plan a 5-day trip to Mumbai from Delhi starting October 15th for 2 adults"
}
```

Response handling:

1. Frontend expects a response containing `tripId`.
2. It stores the returned trip id in local state.
3. It calls `simulateAgentProgress(data.toolResults || [])`.
4. After a short timeout, it navigates to:

```text
/dashboard/trip/{tripId}/overview
```

Important note:

The frontend progress simulation lists `weatherAgent`, but the backend agent name is currently exported as `weatherTool`. That means status matching by exact tool name may not line up for weather unless the names are normalized.

## Route 2: Backend Agent Run

Backend route:

```http
POST /api/agents/run
```

Mounted by:

```js
app.use("/api/agents", agentRoutes);
```

Route definition:

```js
router.post("/run", authenticate, runTripAgents);
```

Files:

```text
backend/app.js
backend/src/routes/agent.routes.js
backend/src/controllers/agent.controller.js
backend/src/middleware/auth.middleware.js
```

Purpose:

This route creates a trip and runs the full multi-agent planning workflow. Weather is step 1 inside the orchestrator.

Authentication workflow:

1. `authenticate` reads the `Authorization` header.
2. It extracts the token after `Bearer`.
3. It verifies the JWT using `process.env.JWT_SECRET`.
4. It assigns the decoded token payload to `req.user`.
5. If the token is missing, invalid, or expired, it returns `401`.

Controller workflow:

1. `runTripAgents(req, res)` reads `req.user?.userId`.
2. It reads `prompt` from `req.body`.
3. If `userId` is missing, it returns `401`.
4. If `prompt` is missing, it returns `400`.
5. It calls:

```js
createTripAndRunOrchestrator({
  userId,
  prompt,
});
```

6. On success, it returns the trip/orchestrator result.
7. On failure, it returns `500` with the error message.

## Route 2A: Trip Creation Before Weather

Function:

```js
createTripAndRunOrchestrator({ userId, prompt })
```

File:

```text
backend/src/agents/tripAgent.js
```

Purpose:

This function parses the prompt, creates the `Trip`, and then starts the orchestrator. Weather cannot run until a `Trip` exists because `weatherAgent` requires `tripId`.

Workflow:

1. Parse the prompt using Groq.
2. If Groq parsing fails, use the fallback parser.
3. Normalize date range so the trip dates are in the future.
4. Normalize city names such as `Bombay` to `Mumbai`.
5. Fetch origin and destination coordinates through Geoapify.
6. Create the `Trip` document with:
   - `user_id`
   - `title`
   - `origin`
   - `origin_coords`
   - `destination`
   - `destination_coords`
   - `start_date`
   - `end_date`
   - `adults`
   - `status`
   - `total_budget`
   - `summary`
7. Call:

```js
runMCPOrchestrator(trip);
```

8. Return a compact response containing trip details and `toolResults`.

## Route 2B: Orchestrator Weather Step

Function:

```js
runMCPOrchestrator(trip)
```

File:

```text
backend/src/agents/orchestrator.js
```

Purpose:

The orchestrator executes all specialized agents in sequence. Weather runs first.

Initial cleanup:

Before any agent runs, the orchestrator deletes old generated data for the trip:

```js
await Promise.all([
  prisma.route.deleteMany({ where: { trip_id: trip.id } }),
  prisma.event.deleteMany({ where: { trip_id: trip.id } }),
  prisma.itineraryItem.deleteMany({ where: { trip_id: trip.id } }),
  prisma.budgetItem.deleteMany({ where: { trip_id: trip.id } }),
  prisma.weatherData.deleteMany({ where: { trip_id: trip.id } }),
  prisma.agentTask.deleteMany({ where: { trip_id: trip.id } }),
]);
```

Weather task data:

```js
const taskData = {
  tripId: trip.id,
  destination: trip.destination,
  startDate: trip.start_date?.toISOString().split("T")[0],
  endDate: trip.end_date?.toISOString().split("T")[0],
};
```

Execution:

```js
const result = await weatherAgent.execute(taskData);
```

Success workflow:

1. Weather rows are already written by `weatherAgent`.
2. `storeWeatherData(trip.id, result)` logs that weather was processed.
3. An `AgentTask` row is created with:
   - `agent_type: weatherAgent.name`
   - `task_data`
   - `result_data`
   - `status: "SUCCESS"`
   - `started_at`
   - `completed_at`
4. `collectedData.weather` is set to the result.
5. `previousToolResults` receives the weather result.
6. `successfulTools` increments.
7. The orchestrator continues to flights, trains, hotels, news, budget, events, itinerary, and maps.

Failure workflow:

1. The orchestrator catches the error.
2. An `AgentTask` row is created with `status: "FAILED"`.
3. `previousToolResults` receives the error message.
4. The orchestrator continues to the remaining agents.

Important note:

The orchestrator is designed to continue after individual tool failures. A weather failure does not abort the full trip workflow.

## Agent: weatherAgent.js

File:

```text
backend/src/agents/weatherAgent.js
```

Export:

```js
export const weatherAgent = {
  name: "weatherTool",
  description: "Fetches weather forecast for a destination using Google Weather via SerpApi and stores daily data in DB.",
  jsonSchema: {
    type: "object",
    properties: {
      tripId: { type: "string" },
      destination: { type: "string" },
      startDate: { type: "string" },
      endDate: { type: "string" },
    },
    required: ["tripId", "destination"],
  },
  validate: (args) => WeatherArgs.parse(args),
  execute: weatherExecute,
};
```

Validation schema:

```js
const WeatherArgs = z.object({
  tripId: MongoObjectId,
  destination: z.string().min(1),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
});
```

Validation workflow:

1. `weatherExecute(args)` starts.
2. Zod validates the input.
3. `tripId` must match a MongoDB ObjectId format.
4. `destination` must be a non-empty string.
5. `startDate` and `endDate` are optional.
6. If validation fails, the error is logged and re-thrown.

Date fallback workflow:

If `startDate` or `endDate` is missing:

1. The agent fetches the trip:

```js
prisma.trip.findUnique({
  where: { id: tripId },
  select: { start_date: true, end_date: true },
});
```

2. If the trip is not found, it throws:

```text
Trip {tripId} not found
```

3. Dates are converted to `YYYY-MM-DD`.

SerpApi workflow:

1. Read `SERPAPI_KEY`.
2. If the key is missing, throw:

```text
SERPAPI_KEY is not set
```

3. Call SerpApi Google weather.
4. Read weather data from either:

```js
response.weather
```

or:

```js
response.answer_box
```

5. Extract:

```js
weatherInfo.forecast
```

6. If `forecast` is missing, empty, or not an array, throw an API-path error.

Forecast normalization workflow:

1. Convert `startDate` and `endDate` to `Date`.
2. Calculate trip duration in days:

```js
Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));
```

3. Loop while both conditions are true:
   - SerpApi still has forecast days.
   - The loop has not exceeded trip duration.
4. For each forecast day:
   - `temperature.high` becomes `temp_high`.
   - `temperature.low` becomes `temp_low`.
   - `weather` becomes `condition`.
   - `precipitation` like `"20%"` becomes number `20`.
   - Raw day JSON is stored as `weather_json`.
5. The date is calculated by adding the loop index to the trip `startDate`.

Database write workflow:

1. Delete existing weather rows:

```js
await prisma.weatherData.deleteMany({
  where: { trip_id: tripId },
});
```

2. Create one row per normalized forecast day:

```js
await prisma.weatherData.create({
  data: {
    trip_id: tripId,
    location: destination,
    date: new Date(day.date),
    temperature_high: day.temp_high,
    temperature_low: day.temp_low,
    conditions: day.condition,
    precipitation: day.precipitation,
    weather_json: day.weather_json,
    fetched_at: new Date(),
  },
});
```

3. Return:

```js
{
  summary: `Stored ${dailyForecast.length} daily forecast entries for ${destination}`,
  daily: dailyForecast,
}
```

Fallback weather workflow:

If the SerpApi/API processing block fails:

1. Calculate trip duration.
2. Create one fallback day for each trip day.
3. Use fixed fallback values:

```js
{
  temp_high: 25,
  temp_low: 18,
  condition: "Sunny",
  precipitation: 0,
  weather_json: {
    fallback: true,
    error: err.message
  }
}
```

4. Delete existing weather rows.
5. Insert fallback weather rows.
6. Return:

```js
{
  summary: `Created ${daily.length} fallback weather entries for ${destination} due to API error.`,
  daily,
}
```

Fallback limitations:

- Missing `SERPAPI_KEY` does not use fallback because it is checked before the `try` block.
- Zod validation errors do not use fallback.
- Missing trip errors do not use fallback.
- Invalid date values can still create bad duration behavior because date strings are not validated beyond being strings.

## Route 3: Trip Weather Data

Backend route:

```http
GET /api/trips/:id/weather
```

Route definition:

```js
router.get("/:id/weather", authenticate, tripController.getWeatherData);
```

Files:

```text
backend/src/routes/trip.routes.js
backend/src/controllers/trip.controller.js
frontend/src/app/dashboard/trip/[id]/weather/page.tsx
```

Purpose:

This route reads weather data that has already been stored by `weatherAgent`.

Important:

This route does not run `weatherAgent`. If no weather rows exist, it returns `404`.

Backend workflow:

1. Authenticate the request.
2. Read `id` from `req.params`.
3. Read `userId` from `req.user.userId`.
4. Verify that the trip belongs to the user:

```js
prisma.trip.findFirst({
  where: { id, user_id: userId },
});
```

5. If the trip is not found, return:

```http
404
```

```json
{
  "error": "Trip not found"
}
```

6. Fetch weather rows:

```js
prisma.weatherData.findMany({
  where: { trip_id: id },
  orderBy: { date: "asc" },
});
```

7. If no rows exist, return:

```http
404
```

```json
{
  "error": "No weather data found for this trip",
  "message": "Run the weather agent first to fetch weather data"
}
```

8. Map database fields into API response fields.

Response shape:

```json
{
  "location": "Mumbai",
  "totalDays": 5,
  "forecast": [
    {
      "date": "2026-10-15T00:00:00.000Z",
      "temp_high": 31,
      "temp_low": 24,
      "condition": "Cloudy",
      "precipitation": 20,
      "weather_json": {},
      "fetched_at": "2026-06-25T00:00:00.000Z"
    }
  ]
}
```

Frontend workflow:

1. Weather page loads at:

```text
/dashboard/trip/{tripId}/weather
```

2. `useEffect()` calls `fetchWeatherData()`.
3. The page reads JWT from `localStorage`.
4. If no token exists, redirect to `/login`.
5. It sends:

```http
GET http://localhost:5000/api/trips/{tripId}/weather
Authorization: Bearer <jwt>
```

6. If the response is not OK, it displays an error state.
7. If successful, it stores the response in `weatherData`.
8. It renders:
   - location title
   - total forecast days
   - high/low temperature summaries
   - precipitation summary
   - weather condition icons
   - chart data
   - packing suggestions

## Route 4: Trip Summary

Backend route:

```http
GET /api/trips/:id/summary
```

Route definition:

```js
router.get("/:id/summary", authenticate, tripController.getTripSummary);
```

Files:

```text
backend/src/routes/trip.routes.js
backend/src/controllers/trip.controller.js
frontend/src/app/dashboard/trip/[id]/overview/page.tsx
frontend/src/app/dashboard/compare/page.tsx
```

Purpose:

This route returns a broad trip summary. It includes a small weather summary generated from stored `WeatherData` rows.

Backend workflow:

1. Authenticate user.
2. Read `id` from route params.
3. Fetch trip by `id` and `user_id`.
4. Include related records:
   - `weather_data`
   - `budget_items`
   - `itinerary_items`
   - `itinerary`
   - `events`
   - `routes`
5. If no trip is found, return `404`.
6. Calculate trip duration.
7. Calculate budget total.
8. Calculate average high temperature:

```js
const avgTemp = trip.weather_data.length > 0
  ? trip.weather_data.reduce((sum, w) => sum + w.temperature_high, 0) / trip.weather_data.length
  : null;
```

9. Build weather summary:

```js
weather: trip.weather_data.length > 0 ? {
  avgTemp: Math.round(avgTemp),
  condition: trip.weather_data[0]?.conditions,
  daysCount: trip.weather_data.length,
} : null
```

10. Return:

```json
{
  "trip": {},
  "summary": {
    "weather": {
      "avgTemp": 31,
      "condition": "Cloudy",
      "daysCount": 5
    }
  }
}
```

Frontend overview workflow:

1. Overview page loads at:

```text
/dashboard/trip/{tripId}/overview
```

2. It calls:

```http
GET http://localhost:5000/api/trips/{tripId}/summary
Authorization: Bearer <jwt>
```

3. It stores `data.summary`.
4. The Weather Forecast navigation card uses:

```js
summary?.weather ? `${summary.weather.avgTemp} F avg` : "N/A"
```

Important note:

The frontend labels the average as Fahrenheit, but the weather agent fallback and email text imply Celsius. Unit handling is currently inconsistent.

## Route 5: Itinerary Routes That Consume Weather Indirectly

Backend routes:

```http
GET /api/trips/:id/itinerary
GET /api/trips/:id/itinerary/items
GET /api/trips/:id/itinerary/full
```

Files:

```text
backend/src/agents/itineraryAgent.js
backend/src/routes/trip.routes.js
backend/src/controllers/trip.controller.js
frontend/src/app/dashboard/trip/[id]/itinerary/page.tsx
```

Purpose:

These routes do not read `WeatherData` directly in the controller, but the itinerary content may already contain weather because `itineraryAgent` reads weather while generating the full plan.

Itinerary generation workflow:

1. Orchestrator runs `weatherAgent` first.
2. Later, orchestrator runs `itineraryAgent`.
3. `itineraryAgent` fetches weather rows:

```js
const weatherData = await prisma.weatherData.findMany({
  where: {
    trip_id: args.tripId,
    date: {
      gte: new Date(args.startDate || trip.start_date),
      lte: new Date(trip.end_date),
    },
  },
  orderBy: { date: "asc" },
});
```

4. For each itinerary day, it finds matching weather by date.
5. It embeds weather into the day plan:

```js
weather: {
  temp_high: dayWeather.temperature_high || 25,
  temp_low: dayWeather.temperature_low || 18,
  condition: dayWeather.conditions || "Partly Cloudy",
}
```

6. It stores the full plan in the `Itinerary` table.
7. It stores day-level rows in `ItineraryItem`.

Route behavior:

- `GET /api/trips/:id/itinerary` returns the main `Itinerary.full_plan`, which may include weather snapshots.
- `GET /api/trips/:id/itinerary/items` returns detailed itinerary rows, but those rows do not contain weather fields.
- `GET /api/trips/:id/itinerary/full` returns both the main itinerary and detailed rows.

Important:

If `weatherAgent` failed and no weather rows exist, `itineraryAgent` still generates fallback day weather inside the plan:

```js
temp_high: 25
temp_low: 18
condition: "Partly Cloudy"
```

## Route 6: Legacy Orchestrator Summary

Backend route:

```http
GET /api/trips/:id/orchestrator
```

Route definition:

```js
router.get("/:id/orchestrator", authenticate, tripController.getOrchestratorSummary);
```

Purpose:

This route reads `Trip.orchestrator_summary`.

Current behavior:

The current orchestrator builds a rich `finalAnswer` containing `weather`, but it updates `Trip.summary`, not `Trip.orchestrator_summary`. Because of that, this route can return:

```json
{
  "error": "No orchestrator summary found for this trip",
  "message": "This field is for backward compatibility. Data is now stored in dedicated fields."
}
```

Use the dedicated routes instead:

```text
GET /api/trips/:id/weather
GET /api/trips/:id/summary
GET /api/trips/:id/itinerary
```

## End-to-End Weather Flow

```text
User submits prompt on /dashboard/new
  -> POST /api/agents/run
    -> authenticate JWT
    -> runTripAgents()
      -> createTripAndRunOrchestrator()
        -> parse prompt
        -> create Trip
        -> runMCPOrchestrator(trip)
          -> delete old generated WeatherData
          -> weatherAgent.execute()
            -> validate args
            -> resolve missing dates from Trip if needed
            -> call SerpApi Google weather
            -> normalize forecast days
            -> delete old WeatherData
            -> create WeatherData rows
            -> return summary + daily forecast
          -> create AgentTask for weather
          -> run remaining agents
          -> fetch final WeatherData
          -> return final trip planning response
  -> frontend redirects to /dashboard/trip/{tripId}/overview
    -> GET /api/trips/{tripId}/summary
      -> summary includes weather average and first condition
  -> user opens /dashboard/trip/{tripId}/weather
    -> GET /api/trips/{tripId}/weather
      -> returns full stored forecast
```

## Status Codes

| Route | Case | Status | Response |
| --- | --- | --- | --- |
| `POST /api/agents/run` | Missing or invalid token | `401` | Unauthorized |
| `POST /api/agents/run` | Missing prompt | `400` | `prompt is required` |
| `POST /api/agents/run` | Orchestration throws | `500` | Error message |
| `GET /api/trips/:id/weather` | Missing or invalid token | `401` | Unauthorized |
| `GET /api/trips/:id/weather` | Trip does not belong to user | `404` | `Trip not found` |
| `GET /api/trips/:id/weather` | No weather rows exist | `404` | `No weather data found for this trip` |
| `GET /api/trips/:id/weather` | Query succeeds | `200` | Forecast response |
| `GET /api/trips/:id/summary` | Trip does not belong to user | `404` | `Trip not found` |
| `GET /api/trips/:id/summary` | Query succeeds | `200` | Trip plus summary |

## Known Issues and Risks

1. No direct weather regeneration route exists.
   - `GET /api/trips/:id/weather` only reads stored rows.
   - To regenerate weather, the full orchestrator must run again or a dedicated route must be added.

2. Unit labels are inconsistent.
   - Frontend weather page and overview show `F`.
   - Fallback values and email output imply Celsius.
   - SerpApi unit handling is not explicitly configured.

3. Future-trip weather may not represent the actual future dates.
   - SerpApi forecast is limited to available forecast days.
   - The code maps forecast index `0` to the trip `startDate`, even if the trip is months away.

4. Date strings are optional but not strictly validated as valid dates.
   - Zod only checks that `startDate` and `endDate` are strings.
   - Invalid date strings can lead to bad date math.

5. Weather writes are not transactional.
   - The code deletes old weather rows, then creates new rows one at a time.
   - A failure midway could leave partial weather data.

6. `weatherAgent.name` is `weatherTool`.
   - The frontend progress list uses `weatherAgent`.
   - Exact matching of tool results may fail unless names are aligned.

7. `SERPAPI_KEY` failure does not use fallback weather.
   - Missing key throws before entering the API fallback `try/catch`.

## Suggested Improvements

1. Add a dedicated route:

```http
POST /api/trips/:id/weather/run
```

This route could verify ownership, load the trip, and call `weatherAgent.execute()`.

2. Add strict date validation:

```js
startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional()
```

3. Make units explicit.
   - Store `unit` in `WeatherData.weather_json`.
   - Display either Celsius or Fahrenheit consistently.

4. Use `createMany` or a transaction-like pattern for weather inserts.

5. Align agent names:

```js
name: "weatherAgent"
```

or update frontend progress matching to accept `weatherTool`.

6. Save current orchestrator results into `orchestrator_summary` or remove the legacy route.
