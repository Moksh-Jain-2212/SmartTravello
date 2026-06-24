import { z } from "zod";
import prisma from "../config/db.js";

// --------------------
// Zod validation schema
// --------------------
const MongoObjectId = z.string().regex(/^[a-f\d]{24}$/i, "Invalid MongoDB ObjectId");

const MapsArgs = z.object({
  tripId: MongoObjectId,
  action: z.enum(["directions", "nearby", "place_details", "distance_matrix"]).default("directions"),
  mode: z.enum(["driving", "walking", "transit", "bicycling"]).optional().default("driving"),
  placeType: z.string().optional(),
});

function getAwsLocationConfig() {
  const apiKey =
    process.env.AWS_LOCATION_API_KEY ||
    process.env.VITE_AWS_LOCATION_API_KEY ||
    process.env.AMAZON_LOCATION_API_KEY;
  const region =
    process.env.AWS_LOCATION_REGION ||
    process.env.VITE_AWS_LOCATION_REGION ||
    process.env.VITE_AWS_REGION ||
    process.env.AWS_REGION ||
    "us-east-1";

  if (!apiKey) {
    throw new Error("AWS_LOCATION_API_KEY or VITE_AWS_LOCATION_API_KEY is not set");
  }

  if (/^(AKIA|ASIA)/.test(apiKey)) {
    throw new Error(
      "VITE_AWS_LOCATION_API_KEY looks like an AWS access key ID. Amazon Location Routes API key auth expects a Location API key, usually starting with v1.public."
    );
  }

  return { apiKey, region };
}

function mapTravelMode(mode) {
  const mapping = {
    driving: "Car",
    walking: "Pedestrian",
    transit: "Transit",
    bicycling: "Scooter",
  };

  return mapping[mode] || "Car";
}

// --------------------
// Main execution function
// --------------------
async function mapsExecute(args) {
  const { tripId, action, mode, placeType } = MapsArgs.parse(args);

  console.log(`[MapsAgent] 🚀 Executing action: ${action || 'directions'}`);

  // Fetch trip data from DB
  const trip = await prisma.trip.findUnique({
    where: { id: tripId },
    select: {
      origin: true,
      destination: true,
      origin_coords: true,
      destination_coords: true,
      start_date: true,
    },
  });

  if (!trip) throw new Error(`Trip with id ${tripId} not found.`);

  const { origin, destination } = trip;
  const awsConfig = getAwsLocationConfig();

  console.log(`[MapsAgent] Processing: ${origin} → ${destination}`);

  // ✅ Let errors propagate to orchestrator - no fallback here
  switch (action) {
    case "directions":
      return await getDirections(trip, mode, tripId, awsConfig);
    case "nearby":
      throw new Error("AWS Location nearby search is not implemented in mapsAgent yet");
    case "place_details":
      throw new Error("AWS Location place details is not implemented in mapsAgent yet");
    case "distance_matrix":
      throw new Error("AWS Location distance matrix is not implemented in mapsAgent yet");
    default:
      return await getDirections(trip, mode, tripId, awsConfig);
  }
}

// --------------------
// Directions Function
// --------------------
async function getDirections(trip, mode, tripId, { apiKey, region }) {
  const { origin, destination, origin_coords, destination_coords } = trip;

  try {
    console.log("[MapsAgent] 📍 Calling AWS Location Routes API...");

    const response = await fetch(`https://routes.geo.${region}.amazonaws.com/v2/routes?key=${encodeURIComponent(apiKey)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        Origin: toAwsPosition(origin_coords),
        Destination: toAwsPosition(destination_coords),
        TravelMode: mapTravelMode(mode),
        LegAdditionalFeatures: ["Summary"],
        LegGeometryFormat: "Simple",
        InstructionsMeasurementSystem: "Metric",
        TravelStepType: "TurnByTurn",
        OptimizeRoutingFor: "FastestRoute",
      }),
    });

    const responseText = await response.text();
    const responseData = responseText ? JSON.parse(responseText) : {};

    if (!response.ok) {
      const message = responseData.Message || responseData.message || responseText || response.statusText;
      throw new Error(`AWS Location Routes API error (${response.status}): ${message}`);
    }

    const route = responseData.Routes?.[0];
    const leg = route?.Legs?.[0];

    if (!route || !leg) {
      throw new Error("AWS Location Routes API did not return a route");
    }

    const routeSummary = route.Summary || {};
    const legDetails = getPrimaryLegDetails(leg);
    const legSummary = legDetails?.Summary?.Overview || {};

    const distanceMeters = routeSummary.Distance ?? legSummary.Distance ?? 0;
    const durationSeconds = routeSummary.Duration ?? legSummary.Duration ?? 0;
    const distanceKm = distanceMeters / 1000;
    const durationMinutes = Math.round(durationSeconds / 60);
    const costEstimate = calculateCostEstimate(distanceKm, durationMinutes, mode);
    const steps = buildGoogleCompatibleSteps(leg, legDetails, origin_coords, destination_coords);
    const fullResponseData = buildGoogleCompatibleResponse({
      origin,
      destination,
      distanceMeters,
      durationSeconds,
      responseData,
      steps,
    });

    console.log("[MapsAgent] 💾 Saving route to database...");

    // Save route with full response
    const routeRecord = await prisma.route.create({
      data: {
        trip_id: tripId,
        from_location: origin,
        to_location: destination,
        transport_mode: mode,
        distance_km: distanceKm,
        duration_minutes: durationMinutes,
        estimated_cost: costEstimate,
        route_data: {
          provider: "aws-location",
          steps,
          line_string: leg.Geometry?.LineString || [],
          notices: responseData.Notices || [],
        },
        full_response: fullResponseData,
      },
    });

    console.log("[MapsAgent] ✅ Route saved successfully - ID:", routeRecord.id);

    return {
      id: routeRecord.id,
      origin,
      destination,
      mode,
      distance: distanceKm,
      duration: durationMinutes,
      estimated_cost: costEstimate,
      steps,
      summary: `Route from ${origin} to ${destination}: ${distanceKm.toFixed(1)} km, ${durationMinutes} min via ${mode}`,
      polyline: leg.Geometry?.Polyline || null,
      provider: "aws-location",
    };
  } catch (error) {
    console.error("[MapsAgent] ❌ Directions error:", error.message);
    throw error; // ✅ Propagate error, don't create fallback
  }
}

function toAwsPosition(coords) {
  if (!coords || typeof coords.lng !== "number" || typeof coords.lat !== "number") {
    throw new Error("Trip coordinates are missing or invalid for AWS Location routing");
  }

  return [coords.lng, coords.lat];
}

function getPrimaryLegDetails(leg) {
  return Object.entries(leg || {}).find(
    ([key, value]) => key.endsWith("LegDetails") && Array.isArray(value?.TravelSteps)
  )?.[1];
}

function toLatLng(position, fallback) {
  if (Array.isArray(position) && position.length >= 2) {
    return { lat: position[1], lng: position[0] };
  }

  return fallback || { lat: 0, lng: 0 };
}

function formatDistance(meters = 0) {
  return meters >= 1000 ? `${(meters / 1000).toFixed(1)} km` : `${Math.round(meters)} m`;
}

function formatDuration(seconds = 0) {
  const minutes = Math.max(1, Math.round(seconds / 60));
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return hours > 0 ? `${hours}h ${mins}m` : `${mins}m`;
}

function buildGoogleCompatibleSteps(leg, legDetails, originCoords, destinationCoords) {
  const lineString = leg.Geometry?.LineString || [];
  const travelSteps = legDetails?.TravelSteps || [];
  const originLatLng = { lat: originCoords.lat, lng: originCoords.lng };
  const destinationLatLng = { lat: destinationCoords.lat, lng: destinationCoords.lng };

  if (travelSteps.length === 0) {
    return [
      {
        distance: { text: "Route distance unavailable", value: 0 },
        duration: { text: "Route duration unavailable", value: 0 },
        html_instructions: "Continue to destination",
        maneuver: "continue",
        start_location: originLatLng,
        end_location: destinationLatLng,
        travel_mode: "DRIVING",
      },
    ];
  }

  return travelSteps.map((step, index) => {
    const nextStep = travelSteps[index + 1];
    const startPosition = lineString[step.GeometryOffset] || lineString[0];
    const endPosition = nextStep
      ? lineString[nextStep.GeometryOffset] || lineString[lineString.length - 1]
      : lineString[lineString.length - 1];

    return {
      distance: {
        text: formatDistance(step.Distance || 0),
        value: step.Distance || 0,
      },
      duration: {
        text: formatDuration(step.Duration || 0),
        value: step.Duration || 0,
      },
      html_instructions: step.Instruction || humanizeStepType(step.Type),
      maneuver: step.Type ? step.Type.toLowerCase() : undefined,
      start_location: toLatLng(startPosition, originLatLng),
      end_location: toLatLng(endPosition, destinationLatLng),
      travel_mode: "DRIVING",
    };
  });
}

function buildGoogleCompatibleResponse({
  origin,
  destination,
  distanceMeters,
  durationSeconds,
  responseData,
  steps,
}) {
  return {
    provider: "aws-location",
    raw: responseData,
    routes: [
      {
        legs: [
          {
            steps,
            distance: {
              text: formatDistance(distanceMeters),
              value: distanceMeters,
            },
            duration: {
              text: formatDuration(durationSeconds),
              value: durationSeconds,
            },
            start_address: origin,
            end_address: destination,
          },
        ],
      },
    ],
  };
}

function humanizeStepType(type) {
  return type ? type.replace(/([a-z])([A-Z])/g, "$1 $2") : "Continue";
}

// --------------------
// Helper Functions
// --------------------
function calculateCostEstimate(distanceKm, durationMinutes, mode) {
  const rates = { driving: distanceKm*12, transit: distanceKm*2, walking:0, bicycling:0 };
  return Math.round(rates[mode] || distanceKm*8);
}

// --------------------
// Exported mapsAgent
// --------------------
export const mapsAgent = {
  name: "mapsTool",
  description: "AWS Location Service integration for directions and route planning",
  jsonSchema: {
    type: "object",
    properties: {
      tripId: { type: "string" },
      action: { type: "string", enum: ["directions","nearby","place_details","distance_matrix"] },
      mode: { type: "string", enum: ["driving","walking","transit","bicycling"] },
      placeType: { type: "string" },
    },
    required: ["tripId"],
  },
  validate: args => MapsArgs.parse(args),
  execute: mapsExecute,
};
