import { TaskRegistry } from "../../../src/core/TaskRegistry";

// Shared Cache for LTA Bus Stops
let busStopCache: Map<string, { description: string; roadName: string; lat: number; lng: number }> | null = null;

async function getBusStopCache(ltaKey: string) {
  if (busStopCache) return busStopCache;
  const headers = { AccountKey: ltaKey, accept: "application/json" };

  busStopCache = new Map();
  let skip = 0;
  while (true) {
    const url = `https://datamall2.mytransport.sg/ltaodataservice/BusStops?$skip=${skip}`;
    const res = await fetch(url, { headers });
    if (!res.ok) break;
    const data = (await res.json()) as any;
    const batch: any[] = data.value || [];
    if (batch.length === 0) break;
    for (const stop of batch) {
      busStopCache.set(stop.BusStopCode, {
        description: stop.Description,
        roadName: stop.RoadName,
        lat: stop.Latitude,
        lng: stop.Longitude,
      });
    }
    if (batch.length < 500) break;
    skip += 500;
  }
  return busStopCache;
}

// Distance helper
function getDistanceKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const dLat = (lat2 - lat1) * (Math.PI / 180);
  const dLon = (lon2 - lon1) * (Math.PI / 180);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * (Math.PI / 180)) * Math.cos(lat2 * (Math.PI / 180)) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function haversine(lat1: number, lng1: number, lat2: number, lng2: number): number {
  return getDistanceKm(lat1, lng1, lat2, lng2) * 1000; // in metres
}

function expandSearchTerms(query: string): string[] {
  const q = query.toLowerCase().trim();
  const terms = [q];
  if (q.includes("marina bay sands")) terms.push("mbs", "bayfront");
  if (q.includes("mbs")) terms.push("marina bay sands", "bayfront");
  if (q.includes("orchard mrt")) terms.push("orchard stn");
  if (q.includes("dhoby ghaut")) terms.push("dhoby ghaut stn");
  if (q.includes("mrt")) terms.push("stn");
  if (q.includes("interchange")) terms.push("int");
  if (q.includes("opposite")) terms.push("opp");
  return terms;
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(new Error("Task cancelled"));
    const timer = setTimeout(resolve, ms);
    signal.addEventListener("abort", () => {
      clearTimeout(timer);
      reject(new Error("Task cancelled"));
    }, { once: true });
  });
}

async function fetchArrivals(stopCode: string, ltaKey: string) {
  const res = await fetch(
    `https://datamall2.mytransport.sg/ltaodataservice/BusArrivalv2?BusStopID=${stopCode}`,
    { headers: { AccountKey: ltaKey, accept: "application/json" } }
  );
  if (!res.ok) return [];

  const data = (await res.json()) as any;
  const getMins = (estArrival: string) => {
    if (!estArrival) return null;
    const diff = new Date(estArrival).getTime() - Date.now();
    const mins = Math.ceil(diff / 60000);
    return mins <= 0 ? "Arr" : `${mins}m`;
  };

  return (data.Services || []).map((s: any) => ({
    serviceNo: s.ServiceNo,
    operator: s.Operator,
    nextBus: getMins(s.NextBus?.EstimatedArrival),
    nextBusLoad: s.NextBus?.Load || "",
    nextBus2: getMins(s.NextBus2?.EstimatedArrival),
    nextBus3: getMins(s.NextBus3?.EstimatedArrival),
  }));
}

function formatUpdate(
  stopCode: string,
  stopLabel: string,
  services: any[],
  filterService?: string
): string {
  const loadEmoji: Record<string, string> = { SEA: "🟢", SDA: "🟡", LSD: "🔴" };
  const filtered = filterService
    ? services.filter((s) => s.serviceNo === filterService)
    : services;

  if (filtered.length === 0) {
    return `🚌 **Bus Stop ${stopCode}** (${stopLabel})\n_No services currently available._`;
  }

  const lines = filtered.map((s) => {
    const load = loadEmoji[s.nextBusLoad] || "";
    const eta2 = s.nextBus2 ? ` · ${s.nextBus2}` : "";
    return `• Bus **${s.serviceNo}**: ${s.nextBus ?? "—"}${eta2} ${load}`;
  });

  return `🚌 **Bus Stop ${stopCode}** — ${stopLabel}\n${lines.join("\n")}`;
}

export async function execute(
  args: {
    action?: "searchPlaces" | "getDirections" | "geocode" | "getBusArrivals" | "getCarparkAvailability" | "getTrafficIncidents" | "getBusStopInfo" | "trackBus" | "transitRoute";
    query?: string;
    origin?: string;
    destination?: string;
    mode?: "driving" | "walking" | "bicycling" | "transit";
    busStopId?: string;
    serviceNo?: string;
    locationQuery?: string;
    latitude?: number;
    longitude?: number;
    intervalSeconds?: number;
    maxMinutes?: number;
    stopName?: string;
    maxStops?: number;
  },
  context?: { chatId: string; alias?: string }
) {
  const chatId = context?.chatId || "default_cli_chat";

  // Compatibility resolution for old aliases
  let action = args.action;
  if (context?.alias === "googleMaps") {
    action = args.action; // already maps directly
  } else if (context?.alias === "ltaDataMall") {
    action = args.action; // already maps directly
  } else if (context?.alias === "trackBus") {
    action = "trackBus";
  } else if (context?.alias === "transitPlanner") {
    action = "transitRoute";
  }

  if (!action) {
    throw new Error("Parameter 'action' is required.");
  }

  const mapsKey = process.env.GOOGLE_MAPS_API_KEY;
  const ltaKey = process.env.LTA_ACCOUNT_KEY;

  switch (action) {
    // ── Google Maps Actions ──────────────────────────────────────────────────
    case "searchPlaces": {
      if (!mapsKey) throw new Error("GOOGLE_MAPS_API_KEY is not configured.");
      if (!args.query) throw new Error("Parameter 'query' is required for searchPlaces.");
      const url = `https://maps.googleapis.com/maps/api/place/textsearch/json?query=${encodeURIComponent(args.query)}&key=${mapsKey}`;
      const res = await fetch(url);
      if (!res.ok) throw new Error(`Places API request failed: ${res.status}`);
      const data = (await res.json()) as any;
      const results = (data.results || []).slice(0, 5).map((r: any) => ({
        name: r.name,
        address: r.formatted_address,
        rating: r.rating,
        userRatingsTotal: r.user_ratings_total,
        location: r.geometry?.location,
      }));
      return { success: true, results };
    }

    case "geocode": {
      if (!mapsKey) throw new Error("GOOGLE_MAPS_API_KEY is not configured.");
      if (!args.query) throw new Error("Parameter 'query' is required for geocode.");
      const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(args.query)}&key=${mapsKey}`;
      const res = await fetch(url);
      if (!res.ok) throw new Error(`Geocoding API request failed: ${res.status}`);
      const data = (await res.json()) as any;
      const results = (data.results || []).slice(0, 3).map((r: any) => ({
        address: r.formatted_address,
        location: r.geometry?.location,
        type: r.types,
      }));
      return { success: true, results };
    }

    case "getDirections": {
      if (!mapsKey) throw new Error("GOOGLE_MAPS_API_KEY is not configured.");
      if (!args.origin || !args.destination) throw new Error("Parameters 'origin' and 'destination' are required.");
      const travelMode = args.mode || "driving";
      const url = `https://maps.googleapis.com/maps/api/directions/json?origin=${encodeURIComponent(args.origin)}&destination=${encodeURIComponent(args.destination)}&mode=${travelMode}&key=${mapsKey}`;
      const res = await fetch(url);
      if (!res.ok) throw new Error(`Directions API request failed: ${res.status}`);
      const data = (await res.json()) as any;
      const routes = (data.routes || []).map((r: any) => {
        const leg = r.legs?.[0];
        return {
          summary: r.summary,
          distance: leg?.distance?.text,
          duration: leg?.duration?.text,
          steps: (leg?.steps || []).map((s: any) => ({
            instructions: s.html_instructions?.replace(/<[^>]*>/g, ""),
            distance: s.distance?.text,
            duration: s.duration?.text,
          })),
        };
      });
      return { success: true, routes };
    }

    // ── LTA DataMall Actions ─────────────────────────────────────────────────
    case "getBusStopInfo": {
      if (!ltaKey) throw new Error("LTA_ACCOUNT_KEY is not configured.");
      const cache = await getBusStopCache(ltaKey);
      const codeInput = args.busStopId || "";

      if (codeInput && /^\d{5}$/.test(codeInput.trim())) {
        const stop = cache.get(codeInput.trim());
        if (!stop) return { success: false, message: `No bus stop found with code '${codeInput}'.` };
        return { success: true, busStopCode: codeInput, ...stop };
      }

      if (args.latitude !== undefined && args.longitude !== undefined) {
        const nearby: any[] = [];
        for (const [code, stop] of cache.entries()) {
          const distKm = getDistanceKm(args.latitude, args.longitude, stop.lat, stop.lng);
          if (distKm <= 1.0) {
            nearby.push({ busStopCode: code, ...stop, distanceMeters: Math.round(distKm * 1000) });
          }
        }
        nearby.sort((a, b) => a.distanceMeters - b.distanceMeters);
        return { success: true, latitude: args.latitude, longitude: args.longitude, matches: nearby.slice(0, 5) };
      }

      const rawQuery = (codeInput || args.locationQuery || "").trim();
      if (!rawQuery) throw new Error("Provide a busStopId code, locationQuery string, or latitude/longitude coordinates.");

      const searchTerms = expandSearchTerms(rawQuery);
      const matches: any[] = [];
      for (const [code, stop] of cache.entries()) {
        const descLower = stop.description.toLowerCase();
        const roadLower = stop.roadName.toLowerCase();
        const hit = searchTerms.some((term) => descLower.includes(term) || roadLower.includes(term));
        if (hit) {
          matches.push({ busStopCode: code, ...stop });
          if (matches.length >= 10) break;
        }
      }
      return { success: true, query: rawQuery, matches };
    }

    case "getBusArrivals": {
      if (!ltaKey) throw new Error("LTA_ACCOUNT_KEY is not configured.");
      if (!args.busStopId) throw new Error("Parameter 'busStopId' is required.");

      let resolvedCode = args.busStopId.trim();
      let stopName: string | null = null;
      let roadName: string | null = null;

      const cache = await getBusStopCache(ltaKey);

      if (!/^\d{5}$/.test(resolvedCode)) {
        const searchTerms = expandSearchTerms(resolvedCode);
        for (const [code, stop] of cache.entries()) {
          const descLower = stop.description.toLowerCase();
          const roadLower = stop.roadName.toLowerCase();
          if (searchTerms.some((term) => descLower.includes(term) || roadLower.includes(term))) {
            resolvedCode = code;
            stopName = stop.description;
            roadName = stop.roadName;
            break;
          }
        }
        if (!/^\d{5}$/.test(resolvedCode)) {
          return { success: false, message: `Could not find a bus stop matching '${args.busStopId}'.` };
        }
      } else {
        const stop = cache.get(resolvedCode);
        if (stop) {
          stopName = stop.description;
          roadName = stop.roadName;
        }
      }

      const services = await fetchArrivals(resolvedCode, ltaKey);
      return { success: true, busStopCode: resolvedCode, stopName, roadName, services };
    }

    case "getCarparkAvailability": {
      if (!ltaKey) throw new Error("LTA_ACCOUNT_KEY is not configured.");
      const url = "https://datamall2.mytransport.sg/ltaodataservice/CarParkAvailabilityv2";
      const res = await fetch(url, { headers: { AccountKey: ltaKey, accept: "application/json" } });
      if (!res.ok) throw new Error(`LTA CarparkAvailability failed: ${res.status}`);
      const data = (await res.json()) as any;
      let carparks = (data.value || []).map((c: any) => ({
        development: c.Development,
        area: c.Area,
        availableLots: c.AvailableLots,
        lotType: c.LotType,
        agency: c.Agency,
      }));

      if (args.locationQuery) {
        const query = args.locationQuery.toLowerCase();
        carparks = carparks.filter(
          (c: any) =>
            c.development.toLowerCase().includes(query) ||
            c.area.toLowerCase().includes(query)
        );
      }
      return { success: true, carparks: carparks.slice(0, 10) };
    }

    case "getTrafficIncidents": {
      if (!ltaKey) throw new Error("LTA_ACCOUNT_KEY is not configured.");
      const url = "https://datamall2.mytransport.sg/ltaodataservice/TrafficIncidents";
      const res = await fetch(url, { headers: { AccountKey: ltaKey, accept: "application/json" } });
      if (!res.ok) throw new Error(`LTA TrafficIncidents failed: ${res.status}`);
      const data = (await res.json()) as any;
      const incidents = (data.value || []).slice(0, 8).map((i: any) => ({
        type: i.Type,
        message: i.Message,
        latitude: i.Latitude,
        longitude: i.Longitude,
      }));
      return { success: true, incidents };
    }

    // ── live tracking ────────────────────────────────────────────────────────
    case "trackBus": {
      if (!ltaKey) throw new Error("LTA_ACCOUNT_KEY is not configured.");
      if (!args.busStopId) throw new Error("Parameter 'busStopId' is required.");

      const { busStopId, serviceNo, intervalSeconds = 60, maxMinutes = 20, stopName } = args;
      let resolvedCode = busStopId.trim();
      let stopLabel = stopName || busStopId;

      try {
        const cache = await getBusStopCache(ltaKey);
        if (!/^\d{5}$/.test(resolvedCode)) {
          const q = resolvedCode.toLowerCase();
          for (const [code, stop] of cache.entries()) {
            const descLower = stop.description.toLowerCase();
            const roadLower = stop.roadName.toLowerCase();
            if (descLower.includes(q) || roadLower.includes(q)) {
              resolvedCode = code;
              stopLabel = `${stop.description}, ${stop.roadName}`;
              break;
            }
          }
        } else if (!stopName) {
          const stop = cache.get(resolvedCode);
          if (stop) stopLabel = `${stop.description}, ${stop.roadName}`;
        }
      } catch (_) {}

      const intervalMs = Math.max(15, intervalSeconds) * 1000;
      const maxMs = Math.max(1, maxMinutes) * 60 * 1000;
      const serviceLabel = serviceNo ? `Bus ${serviceNo} at` : "all buses at";
      const description = `Tracking ${serviceLabel} stop ${resolvedCode} every ${intervalSeconds}s for up to ${maxMinutes}m`;

      const taskRegistry = TaskRegistry.getInstance();
      const taskId = await taskRegistry.startTask(chatId, description, async (signal) => {
        const startTime = Date.now();
        let pollCount = 0;
        let arrivedDetected = false;

        while (!signal.aborted && Date.now() - startTime < maxMs) {
          pollCount++;
          const services = await fetchArrivals(resolvedCode, ltaKey);
          if (signal.aborted) break;

          // adapt structures back for formatUpdate
          const servicesFormatted = services.map(s => ({
            serviceNo: s.serviceNo,
            next: s.nextBus,
            next2: s.nextBus2,
            load: s.nextBusLoad,
          }));

          const message = formatUpdate(resolvedCode, stopLabel, servicesFormatted, serviceNo);
          const elapsed = Math.floor((Date.now() - startTime) / 1000);
          const remaining = Math.ceil((maxMs - (Date.now() - startTime)) / 60000);
          const footer = `\n_Poll #${pollCount} · ${elapsed}s elapsed · stops in ~${remaining}m_`;

          if (signal.aborted) break;
          await taskRegistry.sendUpdate(chatId, message + footer);

          if (serviceNo) {
            const tracked = servicesFormatted.find((s) => s.serviceNo === serviceNo);
            if (tracked?.next === "Arr") {
              arrivedDetected = true;
              await taskRegistry.sendUpdate(
                chatId,
                `` + `✅ Bus **${serviceNo}** has arrived at stop ${resolvedCode}! Tracking stopped.`
              );
              break;
            }
          }

          let nextSleep = intervalMs;
          if (serviceNo) {
            const tracked = servicesFormatted.find((s) => s.serviceNo === serviceNo);
            if (tracked?.next) {
              const mins = parseInt(tracked.next);
              if (!isNaN(mins)) {
                if (mins <= 2) nextSleep = 15_000;
                else if (mins <= 5) nextSleep = 30_000;
              }
            }
          }

          if (signal.aborted) break;
          await sleep(nextSleep, signal);
        }

        return arrivedDetected
          ? `Bus ${serviceNo} arrived at stop ${resolvedCode} after ${pollCount} polls.`
          : `Tracking session ended after ${pollCount} polls (${maxMinutes}m max reached).`;
      });

      return {
        success: true,
        taskId,
        message: `🚌 Now tracking **stop ${resolvedCode}** (${stopLabel})${serviceNo ? ` for Bus **${serviceNo}**` : ""}.\nPolling every **${intervalSeconds}s** for up to **${maxMinutes} minutes**.\n\nSend \`/cancel\` or \`stop tracking\` to stop tracking anytime.`,
      };
    }

    // ── transit planner route ────────────────────────────────────────────────
    case "transitRoute": {
      if (!mapsKey) throw new Error("GOOGLE_MAPS_API_KEY is not configured.");
      if (!ltaKey) throw new Error("LTA_ACCOUNT_KEY is not configured.");
      if (!args.destination) throw new Error("Parameter 'destination' is required.");

      const { destination, origin, maxStops = 3 } = args;

      // Geocode destination
      const geocodeRes = await fetch(
        `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(destination + ", Singapore")}&key=${mapsKey}`
      );
      if (!geocodeRes.ok) throw new Error(`Google Maps Geocoding failed: ${geocodeRes.status}`);
      const geocodeData = (await geocodeRes.json()) as any;

      if (!geocodeData.results?.length) {
        return { success: false, message: `Could not find location: "${destination}".` };
      }

      const destResult = geocodeData.results[0];
      const destAddress = destResult.formatted_address;
      const destLat: number = destResult.geometry.location.lat;
      const destLng: number = destResult.geometry.location.lng;

      // Directions summary
      let transitSummary: string | null = null;
      if (origin) {
        const dirRes = await fetch(
          `https://maps.googleapis.com/maps/api/directions/json?origin=${encodeURIComponent(origin)}&destination=${encodeURIComponent(destAddress)}&mode=transit&key=${mapsKey}`
        );
        if (dirRes.ok) {
          const dirData = (await dirRes.json()) as any;
          const route = dirData.routes?.[0];
          const leg = route?.legs?.[0];
          if (leg) {
            transitSummary = `${leg.duration?.text} (${leg.distance?.text}) via transit`;
          }
        }
      }

      // Load all bus stops
      const cache = await getBusStopCache(ltaKey);
      const allStops = Array.from(cache.entries()).map(([code, stop]) => ({
        code,
        ...stop
      }));

      const nearest = allStops
        .map((stop) => ({
          ...stop,
          distanceM: haversine(destLat, destLng, stop.lat, stop.lng),
        }))
        .sort((a, b) => a.distanceM - b.distanceM)
        .slice(0, maxStops);

      const stopsWithArrivals = await Promise.all(
        nearest.map(async (stop) => {
          const arrivals = await fetchArrivals(stop.code, ltaKey);
          return {
            code: stop.code,
            name: stop.description,
            road: stop.roadName,
            distanceM: Math.round(stop.distanceM),
            walkMinutes: Math.round(stop.distanceM / 80),
            arrivals: arrivals.slice(0, 6).map(a => ({
              serviceNo: a.serviceNo,
              next: a.nextBus,
              next2: a.nextBus2,
              next3: a.nextBus3,
              load: a.nextBusLoad
            })),
          };
        })
      );

      return {
        success: true,
        destination: destAddress,
        destinationCoords: { lat: destLat, lng: destLng },
        transitSummary,
        nearbyStops: stopsWithArrivals,
      };
    }

    default:
      throw new Error(`Unsupported action: ${action}`);
  }
}
