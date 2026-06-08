// ISO-8601 주 계산 유틸 (월요일 시작)
export function getISOWeek(date) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const day = d.getUTCDay() || 7;            // 1(월)~7(일)
  d.setUTCDate(d.getUTCDate() + 4 - day);     // 해당 주 목요일
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
  return { isoYear: d.getUTCFullYear(), isoWeek: week };
}

export function isoWeekToMonday(isoYear, isoWeek) {
  const jan4 = new Date(Date.UTC(isoYear, 0, 4));
  const jan4Day = jan4.getUTCDay() || 7;
  const week1Monday = new Date(jan4);
  week1Monday.setUTCDate(jan4.getUTCDate() - (jan4Day - 1));
  const monday = new Date(week1Monday);
  monday.setUTCDate(week1Monday.getUTCDate() + (isoWeek - 1) * 7);
  return monday;             // 그 주 월요일(UTC)
}

export function addWeeks(isoYear, isoWeek, delta) {
  const monday = isoWeekToMonday(isoYear, isoWeek);
  monday.setUTCDate(monday.getUTCDate() + delta * 7);
  return getISOWeek(new Date(monday.getUTCFullYear(), monday.getUTCMonth(), monday.getUTCDate()));
}

export function weekDates(isoYear, isoWeek) {
  const monday = isoWeekToMonday(isoYear, isoWeek);
  return Array.from({ length: 5 }, (_, i) => {           // 월~금
    const d = new Date(monday);
    d.setUTCDate(monday.getUTCDate() + i);
    return { month: d.getUTCMonth() + 1, day: d.getUTCDate() };
  });
}

export function currentISOWeek() {
  return getISOWeek(new Date());
}
