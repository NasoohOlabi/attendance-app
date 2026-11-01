import { parseAttendanceGrid } from "./store.mjs";

const DATE_HEADER = /^(?:(?:Sun|Mon|Tue|Wed|Thu|Fri|Sat)\s+)?\d{1,2}\/\d{1,2}$/;

function historicalDate(label, today) {
  const match = label.match(/(\d{1,2})\/(\d{1,2})$/);
  if (!match) return null;
  const date = new Date(today.getFullYear(), Number(match[2]) - 1, Number(match[1]));
  if (date > today) date.setFullYear(date.getFullYear() - 1);
  return date;
}

export function attendanceTrend(rows, today = new Date()) {
  const grid = parseAttendanceGrid(rows);
  const columns = grid.header
    .map((value, index) => ({ label: String(value || "").trim(), index }))
    .filter(({ label }) => DATE_HEADER.test(label))
    .map((column) => ({ ...column, date: historicalDate(column.label, today) }));
  const latest = columns.reduce((best, column) => !column.date || (best?.date && best.date >= column.date) ? best : column, null);
  const recent = latest ? columns.slice(0, columns.indexOf(latest) + 1).slice(-14) : columns.slice(-14);
  return recent.map(({ label, index }) => ({
    label,
    count: grid.students.reduce((total, student) => {
      const value = rows[student.rowNumber - 1]?.[index];
      const text = String(value ?? "").trim().toLowerCase();
      const present = value === true || text === "true" || text === "1"
        || text === "yes" || text === "حاضر" || text === "Ø­Ø§Ø¶Ø±";
      return total + (present ? 1 : 0);
    }, 0),
  }));
}
