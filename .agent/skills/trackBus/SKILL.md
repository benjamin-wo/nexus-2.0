---
name: trackBus
description: Starts a live bus tracking session for a specific bus stop in Singapore. Polls LTA DataMall for arrival updates at an interval chosen by the agent (e.g. every 60s if the bus is far, every 20s if it's close), and sends a live Telegram update each poll. Automatically stops when the bus has arrived or after a maximum watch time. Use when the user asks to track, watch, or monitor a bus stop or specific bus service number.
parameters:
  type: object
  properties:
    busStopId:
      type: string
      description: "The 5-digit LTA bus stop code (e.g. '03519') OR a place/landmark name to track (e.g. 'Marina Bay Sands', 'Raffles Hotel', 'Dhoby Ghaut')."
    serviceNo:
      type: string
      description: "Optional. Filter to track a specific bus service number only (e.g. '65', '131'). If omitted, tracks all services at the stop."
    intervalSeconds:
      type: number
      description: "How often to poll in seconds. Agent should set this based on context: use 60 if the next bus is >5 mins away, 30 if 2–5 mins, 15 if imminent. Default: 60."
    maxMinutes:
      type: number
      description: "Maximum number of minutes to keep tracking before automatically stopping. Default: 20."
    stopName:
      type: string
      description: "Optional human-readable name of the stop, used to label Telegram updates (e.g. 'Opp Raffles Hotel'). Will be resolved from LTA if omitted."
  required:
    - busStopId
---
Use this skill to start a background polling loop that tracks live bus arrival timings and sends Telegram updates at agent-chosen intervals. The agent should dynamically set the interval based on how far away the next bus is.
