// In-memory cache for bus stop lookup (populated once per process lifetime)
let busStopCache: Map<string, { description: string; roadName: string; lat: number; lng: number }> | null = null;

export async function getBusStopCache(headers?: Record<string, string>) {
  if (busStopCache) return busStopCache;
  const key = headers?.AccountKey || process.env.LTA_ACCOUNT_KEY || "";
  const reqHeaders = { AccountKey: key, accept: "application/json" };

  busStopCache = new Map();
  let skip = 0;
  while (true) {
    const url = `https://datamall2.mytransport.sg/ltaodataservice/BusStops?$skip=${skip}`;
    const res = await fetch(url, { headers: reqHeaders });
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

export async function execute(args: {
  action: "getBusArrivals" | "getCarparkAvailability" | "getTrafficIncidents" | "getBusStopInfo";
  busStopId?: string;
  locationQuery?: string;
  latitude?: number;
  longitude?: number;
}) {
  const accountKey = process.env.LTA_ACCOUNT_KEY;
  if (!accountKey) {
    throw new Error(
      "LTA_ACCOUNT_KEY is not configured. Please add your LTA DataMall Account Key to environment variables."
    );
  }

  const { action, busStopId, locationQuery, latitude, longitude } = args;
  const headers = {
    AccountKey: accountKey,
    accept: "application/json",
  };

  switch (action) {
    case "getBusStopInfo": {
      const cache = await getBusStopCache(headers);

      if (busStopId && /^\d{5}$/.test(busStopId.trim())) {
        const stop = cache.get(busStopId.trim());
        if (!stop) return { success: false, message: `No bus stop found with code '${busStopId}'.` };
        return { success: true, busStopCode: busStopId, ...stop };
      }

      // Proximity search if latitude & longitude provided
      if (latitude !== undefined && longitude !== undefined) {
        const nearby: any[] = [];
        for (const [code, stop] of cache.entries()) {
          const distKm = getDistanceKm(latitude, longitude, stop.lat, stop.lng);
          if (distKm <= 1.0) { // within 1km
            nearby.push({ busStopCode: code, ...stop, distanceMeters: Math.round(distKm * 1000) });
          }
        }
        nearby.sort((a, b) => a.distanceMeters - b.distanceMeters);
        return { success: true, latitude, longitude, matches: nearby.slice(0, 5) };
      }

      // Text search by description or road name with alias expansion
      const rawQuery = (busStopId || locationQuery || "").trim();
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
      if (!busStopId) {
        throw new Error("Parameter 'busStopId' is required for action 'getBusArrivals'.");
      }

      let resolvedCode = busStopId.trim();
      let stopName: string | null = null;
      let roadName: string | null = null;

      const cache = await getBusStopCache(headers);

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
          return { success: false, message: `Could not find a bus stop matching '${busStopId}'. Try using a 5-digit stop code or landmark name.` };
        }
      } else {
        const stop = cache.get(resolvedCode);
        if (stop) {
          stopName = stop.description;
          roadName = stop.roadName;
        }
      }

      const url = `https://datamall2.mytransport.sg/ltaodataservice/BusArrivalv2?BusStopID=${resolvedCode}`;
      const res = await fetch(url, { headers });
      if (!res.ok) throw new Error(`LTA BusArrival request failed with status: ${res.status}`);

      const data = (await res.json()) as any;
      const services = (data.Services || []).map((s: any) => {
        const getMins = (estArrival: string) => {
          if (!estArrival) return null;
          const diff = new Date(estArrival).getTime() - Date.now();
          const mins = Math.ceil(diff / 60000);
          return mins <= 0 ? "Arr" : `${mins}m`;
        };

        return {
          serviceNo: s.ServiceNo,
          operator: s.Operator,
          nextBus: getMins(s.NextBus?.EstimatedArrival),
          nextBusLoad: s.NextBus?.Load || "",
          nextBus2: getMins(s.NextBus2?.EstimatedArrival),
          nextBus3: getMins(s.NextBus3?.EstimatedArrival),
        };
      });

      return { success: true, busStopCode: resolvedCode, stopName, roadName, services };
    }

    case "getCarparkAvailability": {
      const url = "https://datamall2.mytransport.sg/ltaodataservice/CarParkAvailabilityv2";
      const res = await fetch(url, { headers });
      if (!res.ok) throw new Error(`LTA CarparkAvailability request failed with status: ${res.status}`);

      const data = (await res.json()) as any;
      let carparks = (data.value || []).map((c: any) => ({
        development: c.Development,
        area: c.Area,
        availableLots: c.AvailableLots,
        lotType: c.LotType,
        agency: c.Agency,
      }));

      if (locationQuery) {
        const query = locationQuery.toLowerCase();
        carparks = carparks.filter(
          (c: any) =>
            c.development.toLowerCase().includes(query) ||
            c.area.toLowerCase().includes(query)
        );
      }

      return { success: true, carparks: carparks.slice(0, 10) };
    }

    case "getTrafficIncidents": {
      const url = "https://datamall2.mytransport.sg/ltaodataservice/TrafficIncidents";
      const res = await fetch(url, { headers });
      if (!res.ok) throw new Error(`LTA TrafficIncidents request failed with status: ${res.status}`);

      const data = (await res.json()) as any;
      const incidents = (data.value || []).slice(0, 8).map((i: any) => ({
        type: i.Type,
        message: i.Message,
        latitude: i.Latitude,
        longitude: i.Longitude,
      }));

      return { success: true, incidents };
    }

    default:
      throw new Error(`Unsupported action: ${action}`);
  }
}
