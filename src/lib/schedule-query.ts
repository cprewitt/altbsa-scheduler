import { addDays, format } from "date-fns";
import { fromZonedTime } from "date-fns-tz";
import { FACILITY_TZ } from "./time";

export { weekQueryParam, parseWeekParam } from "./time";

/** Week range as UTC ISO strings, interpreting weekStart as facility-local days. */
export function addDaysIsoRange(weekStart: Date, days: number) {
  const startLocal = format(weekStart, "yyyy-MM-dd") + " 00:00:00";
  const endLocal =
    format(addDays(weekStart, days), "yyyy-MM-dd") + " 00:00:00";
  return {
    rangeStart: fromZonedTime(startLocal, FACILITY_TZ).toISOString(),
    rangeEnd: fromZonedTime(endLocal, FACILITY_TZ).toISOString(),
  };
}
