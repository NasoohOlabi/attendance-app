const clone = (value) => structuredClone(value);

function setValue(grid, row, column, value) {
  while (grid.rows.length <= row) grid.rows.push([]);
  while (grid.rows[row].length <= column) grid.rows[row].push("");
  grid.rows[row][column] = value ?? "";
}

function getCell(grid, row, column) {
  const key = `${row},${column}`;
  return grid.cells.get(key) || { userEnteredValue: grid.rows[row]?.[column] ?? "" };
}

function setCell(grid, row, column, cell, fields) {
  const key = `${row},${column}`;
  const prior = getCell(grid, row, column);
  const next = { ...prior };
  if (fields.includes("userEnteredValue")) {
    next.userEnteredValue = cell.userEnteredValue || "";
    if (cell.userEnteredValue?.formulaValue) next.formula = cell.userEnteredValue.formulaValue;
    else delete next.formula;
    const entered = cell.userEnteredValue || {};
    setValue(grid, row, column, entered.stringValue ?? entered.numberValue ?? entered.formulaValue ?? "");
  }
  if (fields.includes("dataValidation")) {
    if (cell.dataValidation) next.dataValidation = clone(cell.dataValidation);
    else delete next.dataValidation;
  }
  if (fields.includes("userEnteredFormat.numberFormat")) {
    next.userEnteredFormat = { ...(next.userEnteredFormat || {}), numberFormat: clone(cell.userEnteredFormat?.numberFormat) };
  }
  if (next.userEnteredValue?.numberValue != null && next.userEnteredFormat?.numberFormat?.pattern === "d/m") {
    const date = new Date(Date.UTC(1899, 11, 30) + next.userEnteredValue.numberValue * 86400000);
    next.formattedValue = `${date.getUTCDate()}/${date.getUTCMonth() + 1}`;
    setValue(grid, row, column, next.formattedValue);
  }
  grid.cells.set(key, next);
}

function a1Column(text) {
  let n = 0;
  for (const char of text) n = n * 26 + char.charCodeAt(0) - 64;
  return n - 1;
}

function parseA1(range) {
  const rowRange = /^(?:'((?:[^']|'')+)'|([^!]+))!(\d+):(\d+)$/i.exec(range);
  if (rowRange) return {
    title: (rowRange[1] || rowRange[2]).replaceAll("''", "'"), startColumn: 0, endColumn: 51,
    startRow: Number(rowRange[3]) - 1, endRow: Number(rowRange[4]) - 1,
  };
  const match = /^(?:'((?:[^']|'')+)'|([^!]+))!([A-Z]+)(\d+)?(?::([A-Z]+)(\d+)?)?$/i.exec(range);
  if (!match) throw new Error(`Invalid range ${range}`);
  return {
    title: (match[1] || match[2]).replaceAll("''", "'"),
    startColumn: a1Column(match[3].toUpperCase()),
    startRow: match[4] ? Number(match[4]) - 1 : 0,
    endColumn: match[5] ? a1Column(match[5].toUpperCase()) : a1Column(match[3].toUpperCase()),
    endRow: match[6] ? Number(match[6]) - 1 : (match[4] ? Number(match[4]) - 1 : 999),
  };
}

export function createSheets({ day = "12/10", students } = {}) {
  const roster = students ?? [
    ["أحمد طالب", "00 00 000 001", "", "", "+963 900000001", "TRUE", ""],
    ["أحمد طالب", "00 00 000 002", "", "", "+963 900000002", "FALSE", ""],
    ["سلمى طالبة", "00 00 000 003", "", "", "+963 900000003", "TRUE", ""],
  ];
  const info = {
    spreadsheetId: "attendance-test", sheetId: 1, title: "Info",
    rows: [["إسم كامل", "معرف", day, "11/10", "هاتف", "نشط", "ملاحظة"], ["", "", "=COUNTA(C3:C)", "=COUNTA(D3:D)"], ...clone(roster)],
    cells: new Map(),
  };
  const serial = (dateText) => {
    const [d, m] = dateText.split("/").map(Number);
    return Math.round((Date.UTC(2026, m - 1, d) - Date.UTC(1899, 11, 30)) / 86400000);
  };
  info.cells.set("0,2", { userEnteredValue: { numberValue: serial(day) }, formattedValue: day, userEnteredFormat: { numberFormat: { type: "DATE", pattern: "d/m" } } });
  info.cells.set("0,3", { userEnteredValue: { numberValue: serial("11/10") }, formattedValue: "11/10", userEnteredFormat: { numberFormat: { type: "DATE", pattern: "d/m" } } });
  info.cells.set("1,2", { formula: "=COUNTA(C3:C)" });
  info.cells.set("1,3", { formula: "=COUNTA(D3:D)" });
  for (let row = 2; row < info.rows.length; row++) {
    for (const column of [2, 3]) info.cells.set(`${row},${column}`, { dataValidation: { condition: { type: "BOOLEAN", values: [{ userEnteredValue: "حاضر" }] }, strict: true, showCustomUi: true } });
  }
  const log = { spreadsheetId: "pages-test", sheetId: 2, title: "AttendanceLog", rows: [["الطالب", "إسم", "حضور"]], cells: new Map() };
  const prints = { spreadsheetId: "pages-test", sheetId: 3, title: "FingerPrints", rows: [["student_id", "fingerprint", "created_at"]], cells: new Map() };
  const grids = [info, log, prints];
  const requests = [];
  const sheetFor = (spreadsheetId, title) => {
    const grid = grids.find((item) => item.spreadsheetId === spreadsheetId && item.title === title);
    if (!grid) throw new Error(`Unknown sheet ${spreadsheetId}/${title}`);
    return grid;
  };
  const sheetById = (spreadsheetId, sheetId) => {
    const grid = grids.find((item) => item.spreadsheetId === spreadsheetId && item.sheetId === sheetId);
    if (!grid) throw new Error(`Unknown sheet id ${sheetId}`);
    return grid;
  };
  const api = {
    grids, requests, offline: false,
    failNext: null,
    grid(title) { return grids.find((item) => item.title === title); },
    async request(opts) {
      requests.push(clone(opts));
      if (api.offline) throw new Error("offline");
      if (api.failNext && (!api.failNext.predicate || api.failNext.predicate(opts))) {
        const error = api.failNext.error;
        api.failNext = null;
        throw error;
      }
      const url = new URL(opts.url);
      if (url.origin !== "https://sheets.googleapis.com") throw new Error(`Unknown endpoint ${url.origin}`);
      const match = /^\/v4\/spreadsheets\/(.+)$/.exec(url.pathname);
      if (!match) throw new Error(`Unknown endpoint ${url.pathname}`);
      const spreadsheetId = [...new Set(grids.map((grid) => grid.spreadsheetId))].find((id) => match[1].startsWith(encodeURIComponent(id)));
      if (!spreadsheetId) throw new Error(`Unknown spreadsheet ${match[1]}`);
      const suffix = match[1].slice(encodeURIComponent(spreadsheetId).length);
      if (suffix === "" && (opts.method || "GET") === "GET") {
        const requestedRange = url.searchParams.get("ranges");
        if (requestedRange) {
          const parsed = parseA1(requestedRange);
          const grid = sheetFor(spreadsheetId, parsed.title);
          return { data: { sheets: [{ properties: { sheetId: grid.sheetId }, data: [{ rowData: [{ values: [{ userEnteredFormat: clone(getCell(grid, parsed.startRow, parsed.startColumn).userEnteredFormat || {}) }] }] }] }] } };
        }
        return { data: { sheets: grids.filter((grid) => grid.spreadsheetId === spreadsheetId).map((grid) => ({ properties: { sheetId: grid.sheetId, title: grid.title, gridProperties: { rowCount: Math.max(1000, grid.rows.length) } } })) } };
      }
      if (suffix === ":batchUpdate" && opts.method === "POST") {
        for (const request of opts.data?.requests || []) {
          if (request.updateCells) {
            const { start, rows, fields } = request.updateCells;
            const grid = sheetById(spreadsheetId, start.sheetId);
            rows.forEach((row, ri) => row.values.forEach((cell, ci) => setCell(grid, start.rowIndex + ri, start.columnIndex + ci, cell, fields)));
          } else if (request.insertDimension) {
            const { range } = request.insertDimension;
            const grid = sheetById(spreadsheetId, range.sheetId);
            if (range.dimension !== "COLUMNS" || range.endIndex !== range.startIndex + 1) throw new Error("Unsupported insertDimension");
            for (const row of grid.rows) row.splice(range.startIndex, 0, "");
            const moved = new Map();
            for (const [key, cell] of grid.cells) {
              const [r, c] = key.split(",").map(Number);
              moved.set(`${r},${c >= range.startIndex ? c + 1 : c}`, cell);
            }
            grid.cells = moved;
          } else if (request.copyPaste) {
            const { source, destination, pasteType } = request.copyPaste;
            const grid = sheetById(spreadsheetId, source.sheetId);
            if (pasteType !== "PASTE_DATA_VALIDATION") throw new Error(`Unsupported paste type ${pasteType}`);
            for (let row = 0; row < source.endRowIndex - source.startRowIndex; row++) {
              const sourceCell = getCell(grid, source.startRowIndex + row, source.startColumnIndex);
              const dest = getCell(grid, destination.startRowIndex + row, destination.startColumnIndex);
              if (sourceCell.dataValidation) dest.dataValidation = clone(sourceCell.dataValidation);
              grid.cells.set(`${destination.startRowIndex + row},${destination.startColumnIndex}`, dest);
            }
          } else if (request.deleteDimension) {
            const { range } = request.deleteDimension;
            const grid = sheetById(spreadsheetId, range.sheetId);
            if (range.dimension !== "ROWS") throw new Error("Unsupported deleteDimension");
            grid.rows.splice(range.startIndex, range.endIndex - range.startIndex);
            const moved = new Map();
            for (const [key, cell] of grid.cells) {
              const [r, c] = key.split(",").map(Number);
              if (r < range.startIndex) moved.set(key, cell);
              else if (r >= range.endIndex) moved.set(`${r - range.endIndex + range.startIndex},${c}`, cell);
            }
            grid.cells = moved;
          } else throw new Error(`Unsupported batch request ${Object.keys(request).join(",")}`);
        }
        return { data: {} };
      }
      if (suffix.startsWith("/values/")) {
        const valuePath = suffix.slice("/values/".length);
        const actionMatch = /:(append|clear)$/.exec(valuePath);
        const action = actionMatch?.[1];
        const range = decodeURIComponent(action ? valuePath.slice(0, -actionMatch[0].length) : valuePath);
        const { title, startColumn, startRow, endColumn, endRow } = parseA1(range);
        const grid = sheetFor(spreadsheetId, title);
        if (action === "append" && opts.method === "POST") {
          for (const row of opts.data?.values || []) grid.rows.push([...row]);
          return { data: { updates: {} } };
        }
        if (action === "clear" && opts.method === "POST") {
          if (spreadsheetId !== "pages-test") throw new Error("clear is only supported for log tabs");
          for (let r = startRow; r <= endRow && r < grid.rows.length; r++) for (let c = startColumn; c <= endColumn; c++) setValue(grid, r, c, "");
          return { data: {} };
        }
        if (!action && (opts.method || "GET") === "GET") {
          const render = url.searchParams.get("valueRenderOption") || "FORMATTED_VALUE";
          const values = [];
          for (let r = startRow; r <= endRow && r < grid.rows.length; r++) {
            const row = [];
            for (let c = startColumn; c <= endColumn; c++) {
              const cell = getCell(grid, r, c);
              const raw = grid.rows[r]?.[c] ?? "";
              const value = render === "FORMULA" ? (cell.formula || "") : render === "UNFORMATTED_VALUE" ? (cell.userEnteredValue?.numberValue ?? raw) : (cell.formattedValue ?? raw);
              row.push(value);
            }
            while (row.length && row.at(-1) === "") row.pop();
            values.push(row);
          }
          while (values.length && !values.at(-1).length) values.pop();
          return { data: { values } };
        }
        if (!action && opts.method === "PUT") {
          for (const [ri, row] of (opts.data?.values || []).entries()) for (const [ci, value] of row.entries()) {
            setValue(grid, startRow + ri, startColumn + ci, value);
            grid.cells.set(`${startRow + ri},${startColumn + ci}`, { userEnteredValue: { stringValue: value } });
          }
          return { data: {} };
        }
      }
      throw new Error(`Unknown endpoint ${opts.method || "GET"} ${url.pathname}${url.search} (suffix ${suffix})`);
    },
  };
  api.failNextWith = (error, predicate) => { api.failNext = { error, predicate }; };
  return api;
}
