---
name: maps
description: Accesses Google Maps Platform and Singapore LTA DataMall to search places, get directions, geocode, fetch live bus arrivals, look up carpark spots, monitor traffic, start background bus tracking, or plan door-to-door transit routes.
parameters:
  type: object
  properties:
    action:
      type: string
      enum: [searchPlaces, getDirections, geocode, getBusArrivals, getCarparkAvailability, getTrafficIncidents, getBusStopInfo, trackBus, transitRoute]
      description: "The transport/maps action to perform. 'searchPlaces' to search places on Google Maps, 'getDirections' for driving/walking routing, 'geocode' to resolve address to coordinates, 'getBusArrivals' for live bus arrival times, 'getCarparkAvailability' for carpark lots, 'getTrafficIncidents' for traffic logs, 'getBusStopInfo' to resolve stop code to name, 'trackBus' to start a background bus tracking alert, or 'transitRoute' to plan a door-to-door public transit journey in Singapore."
    query:
      type: string
      description: "Used by searchPlaces, geocode, getBusStopInfo. The location, address, or landmark query."
    origin:
      type: string
      description: "Used by getDirections (Google Maps) and transitRoute (Singapore transit planner). The starting address or coordinates."
    destination:
      type: string
      description: "Used by getDirections (Google Maps) and transitRoute (Singapore transit planner). The target destination address or coordinates."
    mode:
      type: string
      enum: [driving, walking, bicycling, transit]
      description: "Used by getDirections. Travel mode (default driving)."
    busStopId:
      type: string
      description: "Used by getBusArrivals, getBusStopInfo, and trackBus. The 5-digit bus stop code (e.g. '03519') or name of stop."
    serviceNo:
      type: string
      description: "Used by trackBus. Optional filter for specific bus service number (e.g. '65')."
    locationQuery:
      type: string
      description: "Used by getCarparkAvailability and getBusStopInfo to filter by location/area."
    latitude:
      type: number
      description: "Used by getBusStopInfo to search for nearby stops."
    longitude:
      type: number
      description: "Used by getBusStopInfo to search for nearby stops."
    intervalSeconds:
      type: number
      description: "Used by trackBus. Number of seconds between live bus timing updates. Default: 60."
    maxMinutes:
      type: number
      description: "Used by trackBus. Max minutes to keep tracking before auto-stopping. Default: 20."
    stopName:
      type: string
      description: "Used by trackBus. Custom label for the bus stop."
    maxStops:
      type: number
      description: "Used by transitRoute. Maximum number of nearby stops to include in the plan."
  required:
    - action
---
Use this skill for all routing, maps, place search, travel directions, Singapore bus timing checks, live bus tracking alerts, and parking searches.
- When the user asks for bus arrivals or timings, use 'getBusArrivals'.
- If the user wants to watch a bus or get live updates as it approaches, use 'trackBus'. This starts a background task.
- To get from place A to place B in Singapore via transit, use 'transitRoute'.
- For basic geocoding or place searching, use 'geocode' or 'searchPlaces'.
