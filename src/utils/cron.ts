export function parseCronToken(field: string, min: number, max: number): number[] {
  const allowed: number[] = [];
  if (field === "*") {
    for (let i = min; i <= max; i++) allowed.push(i);
    return allowed;
  }

  const parts = field.split(",");
  for (const part of parts) {
    if (part.startsWith("*/")) {
      const step = parseInt(part.slice(2), 10);
      if (isNaN(step) || step <= 0) throw new Error(`Invalid cron step: ${part}`);
      for (let i = min; i <= max; i += step) allowed.push(i);
    } else if (part.includes("-")) {
      const [startStr, endStr] = part.split("-");
      const start = parseInt(startStr, 10);
      const end = parseInt(endStr, 10);
      if (isNaN(start) || isNaN(end)) throw new Error(`Invalid cron range: ${part}`);
      for (let i = start; i <= end; i++) allowed.push(i);
    } else {
      const val = parseInt(part, 10);
      if (isNaN(val)) throw new Error(`Invalid cron field value: ${part}`);
      allowed.push(val);
    }
  }
  return allowed;
}

export function getNextCronDate(cronPattern: string, fromDate = new Date()): Date {
  const fields = cronPattern.trim().split(/\s+/);
  if (fields.length !== 5) {
    throw new Error(`Invalid cron expression '${cronPattern}'. Must have 5 fields: 'minute hour day month dayOfWeek'`);
  }

  const allowedMinutes = parseCronToken(fields[0], 0, 59);
  const allowedHours = parseCronToken(fields[1], 0, 23);
  const allowedDays = parseCronToken(fields[2], 1, 31);
  const allowedMonths = parseCronToken(fields[3], 1, 12);
  const allowedDaysOfWeek = parseCronToken(fields[4], 0, 6);

  // Start checking candidate date from 1 minute after fromDate
  const candidate = new Date(fromDate.getTime());
  candidate.setSeconds(0, 0);
  candidate.setMinutes(candidate.getMinutes() + 1);

  const maxLimit = new Date(candidate.getTime() + 366 * 24 * 60 * 60 * 1000);

  while (candidate < maxLimit) {
    const month = candidate.getMonth() + 1;
    if (!allowedMonths.includes(month)) {
      candidate.setMonth(candidate.getMonth() + 1, 1);
      candidate.setHours(0, 0, 0, 0);
      continue;
    }

    const day = candidate.getDate();
    const dayOfWeek = candidate.getDay();
    const dayMatches =
      fields[2] === "*" && fields[4] !== "*"
        ? allowedDaysOfWeek.includes(dayOfWeek)
        : fields[4] === "*" && fields[2] !== "*"
        ? allowedDays.includes(day)
        : allowedDays.includes(day) && allowedDaysOfWeek.includes(dayOfWeek);

    if (!dayMatches) {
      candidate.setDate(candidate.getDate() + 1);
      candidate.setHours(0, 0, 0, 0);
      continue;
    }

    const hour = candidate.getHours();
    if (!allowedHours.includes(hour)) {
      candidate.setHours(candidate.getHours() + 1, 0, 0, 0);
      continue;
    }

    const minute = candidate.getMinutes();
    if (!allowedMinutes.includes(minute)) {
      candidate.setMinutes(candidate.getMinutes() + 1, 0, 0);
      continue;
    }

    return candidate;
  }

  throw new Error(`Could not find next run date for cron expression '${cronPattern}' within 1 year.`);
}
