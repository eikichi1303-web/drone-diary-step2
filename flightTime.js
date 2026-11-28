export function normalizeFlightMinutes(minutes) {
  return minutes === 0 ? 1 : minutes;
}

export function isValidFlightMinutes(minutes) {
  return Number.isInteger(minutes) && minutes >= 1;
}

export function isCountableCompletedFlight(record) {
  return record?.status === "完了" && (record.cancelledAt === "" || record.cancelledAt === null || record.cancelledAt === undefined);
}

export function getFlightMinutesForRecord(record) {
  if (!record || (record.flightMinutes !== null && record.flightMinutes !== undefined)) {
    if (!record) return null;
    // 保存値が非有限または非整数の場合は無視し、日時からの導出にフォールバックする。
    if (Number.isFinite(record.flightMinutes) && Number.isInteger(record.flightMinutes)) {
      return record.flightMinutes;
    }
  }

  if (!record.takeoffAt || !record.landingAt) {
    return null;
  }

  const elapsedMinutes = (new Date(record.landingAt) - new Date(record.takeoffAt)) / 60000;
  if (!Number.isFinite(elapsedMinutes) || elapsedMinutes < 0) {
    return null;
  }

  return normalizeFlightMinutes(Math.ceil(elapsedMinutes));
}

export function getMaximumAllowedFlightMinutes(takeoffAt, landingAt) {
  const takeoffTime = new Date(takeoffAt).getTime();
  const landingTime = new Date(landingAt).getTime();

  if (!Number.isFinite(takeoffTime) || !Number.isFinite(landingTime)) {
    return null;
  }

  if (landingTime < takeoffTime) {
    return null;
  }

  const elapsedMinutes = (landingTime - takeoffTime) / 60000;

  // 正の日時差は切り上げる。1分未満の場合も上限は1分とする。
  return Math.max(1, Math.ceil(elapsedMinutes));
}

export function sortCompletedFlights(records) {
  return [...records].sort((a, b) => {
    const byTakeoff = String(a?.takeoffAt ?? "").localeCompare(String(b?.takeoffAt ?? ""));
    if (byTakeoff !== 0) {
      return byTakeoff;
    }
    return String(a?.createdAt ?? "").localeCompare(String(b?.createdAt ?? ""));
  });
}

export function calculateAircraftTotalFlightMinutes(aircraft, records) {
  const completedFlights = sortCompletedFlights(records.filter(isCountableCompletedFlight));
  let total = Number.isFinite(aircraft?.initialTotalFlightMinutes)
    ? aircraft.initialTotalFlightMinutes
    : 0;

  for (const record of completedFlights) {
    const minutes = getFlightMinutesForRecord(record);
    if (minutes !== null && minutes !== undefined) {
      total += minutes;
    }
  }

  return total;
}

