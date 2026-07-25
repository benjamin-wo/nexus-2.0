---
name: ltaDataMall
description: Accesses Singapore Land Transport Authority (LTA) DataMall for live bus timings, carpark slots, and traffic incidents.
parameters:
  type: object
  properties:
    action:
      type: string
      enum: [getBusArrivals, getCarparkAvailability, getTrafficIncidents, getBusStopInfo]
      description: "The LTA action to perform: 'getBusArrivals' for live bus arrivals at a stop, 'getCarparkAvailability' for carpark slot counts, 'getTrafficIncidents' for accidents/roadworks, or 'getBusStopInfo' to resolve a stop code to its name/road or search by location/coordinates."
    busStopId:
      type: string
      description: "Required for 'getBusArrivals'. The 5-digit Singapore bus stop code (e.g. '81111') or a text query describing the stop or landmark name (e.g. 'Dhoby Ghaut', 'Marina Bay Sands', 'Orchard MRT')."
    locationQuery:
      type: string
      description: "Optional for 'getCarparkAvailability' or 'getBusStopInfo'. Filter carparks or bus stops by location name (e.g. 'Orchard' or 'Marina')."
    latitude:
      type: number
      description: "Optional for 'getBusStopInfo'. Latitude coordinate from Google Maps to search for nearby bus stops within walking distance."
    longitude:
      type: number
      description: "Optional for 'getBusStopInfo'. Longitude coordinate from Google Maps to search for nearby bus stops within walking distance."
  required:
    - action
---
Use this skill when the user asks for Singapore transport info, such as bus timings, bus arrivals, carpark availability, traffic accidents/jams, or to resolve a bus stop code/landmark/coordinates to human-readable stop names.
