import { readFile } from "node:fs/promises";
import { GoogleAuth } from "google-auth-library";
import { planDateColumn, sheetsSerial } from "./store.mjs";

// The attendance tab is a date grid. A present cell is the checkbox whose checked
// value is حاضر. values.update stores that word and deletes the checkbox, so the
// mark goes through updateCells with the rule beside it. The log sheet and the
// fingerprints tab get their own rows, keyed by the Marif id.

export const SCOPES = ["https://www.googleapis.com/auth/spreadsheets"];

const SHEET_OPERATIONS = [
  ["Time log append", "The time log was not written."],
  ["Time log clear", "The time log was not written."],
  ["Time log read", "The time log was not written."],
  ["Roster read", "The student list could not be loaded."],
  ["Fingerprint sheet append", "The fingerprint sheet was not written."],
  ["Fingerprint sheet read", "The fingerprint sheet could not be read."],
  ["Attendance cell", "The attendance cell was not written."],
  ["Sheet append", "The sheet could not be updated."],
  ["Sheet update", "The sheet could not be updated."],
  ["Google request", "The sheet could not be updated."],
];

function quotedSheetTitle(url) {
  const decoded = (() => {
    try { return decodeURIComponent(url); } catch { return url; }
  })();
  return (decoded.match(/values\/'((?:[^']|'')*)'!/) || [])[1]?.replaceAll("''", "'") || "";
}

function operationFromRequest(method, url) {
  const title = quotedSheetTitle(url);
  const decoded = (() => {
    try { return decodeURIComponent(url); } catch { return url; }
  })();
  const label = `${title} ${decoded}`.toLowerCase();
  const log = label.includes("attendancelog") || title.includes("حضور");
  const prints = label.includes("fingerprint");
  if (decoded.includes(":append")) {
    if (prints) return "Fingerprint sheet append";
    if (log) return "Time log append";
    return "Sheet append";
  }
  if (decoded.includes(":clear")) return "Time log clear";
  if (method === "GET" && decoded.includes("/values/")) {
    if (prints) return "Fingerprint sheet read";
    if (log) return "Time log read";
    return "Roster read";
  }
  if ((method === "PUT" || method === "POST") && decoded.includes("/values/")) return "Attendance cell";
  if (decoded.includes(":batchUpdate")) return "Sheet update";
  return "Google request";
}

function shortReason(detail) {
  let text = String(detail || "").trim();
  if (text.startsWith("{") || text.startsWith("[")) {
    try {
      const body = JSON.parse(text);
      const error = body?.error;
      text = (typeof error === "string" ? error : error?.message || error?.status || "") || body?.message || "";
    } catch {
      text = "";
    }
  }
  text = text.replace(/https?:\/\/\S+/gi, "").replace(/[{}"[\]]/g, " ").replace(/\s+/g, " ").trim();
  if (/does not have permission|insufficient permission/i.test(text)) return "permission denied";
  if (/protected cell|protected range/i.test(text)) return "protected range";
  if (!text) return "the request failed";
  return text.slice(0, 80);
}

function parseGoogleFailure(message) {
  const match = String(message || "").match(/^Google API (\w+) (\S+) failed \(([^)]+)\): ([\s\S]*)$/);
  if (!match) return null;
  return {
    method: match[1],
    url: match[2],
    status: match[3],
    detail: match[4],
    operation: operationFromRequest(match[1], match[2]),
  };
}

function operatorFor(operation) {
  return SHEET_OPERATIONS.find(([name]) => name === operation)?.[1] || "The sheet could not be updated.";
}

/** One sentence for the room, and one line for the person fixing it. The URL stays out of both. */
export function describeApiFailure(message, email = "") {
  const text = String(message || "").trim();
  const parsed = parseGoogleFailure(text);
  if (/protected cell|protected range/i.test(text)) {
    return {
      operator: "That cell is in a protected range, so the sheet was not changed.",
      developer: `${parsed?.operation || "Attendance cell"} failed (${parsed?.status || "403"}): protected range.`,
    };
  }
  if (/does not have permission|insufficient permission/i.test(text)) {
    return {
      operator: email ? `Sheet permission denied. Share as Editor with ${email}` : "Sheet permission denied.",
      developer: `${parsed?.operation || "Google request"} failed (${parsed?.status || "403"}): permission denied.`,
    };
  }
  if (!parsed) return { operator: text, developer: "" };
  const reason = shortReason(parsed.detail);
  return {
    operator: operatorFor(parsed.operation),
    developer: `${parsed.operation} failed (${parsed.status}): ${reason}.`,
  };
}

/** Share-as-Editor only when the API itself says the caller lacks permission. */
export function explainApiFailure(message, email = "") {
  return describeApiFailure(message, email).operator;
}

export function isSheetPermissionError(message) {
  return /does not have permission|insufficient permission/i.test(String(message || ""));
}

/** A dropped network. Permission and bad requests stay errors. */
export const SHEET_RATE_LIMIT = "Google Sheets is rate limited. Trying again in a minute.";

const READ_PAUSE_MS = 60_000;
let readsPausedUntil = 0;
const sheetTitles = new WeakMap();

function titlesFor(client) {
  if (!sheetTitles.has(client)) sheetTitles.set(client, new Map());
  return sheetTitles.get(client);
}

async function sheetProperties(client, spreadsheetId) {
  const titles = titlesFor(client);
  if (!titles.has(spreadsheetId)) {
    const request = grequest(client, {
      url: sheetsUrl(spreadsheetId, "?fields=sheets.properties(sheetId,title)"),
    }).then((meta) => (meta.sheets || []).map((sheet) => sheet.properties));
    titles.set(spreadsheetId, request);
    try {
      await request;
    } catch (err) {
      titles.delete(spreadsheetId);
      throw err;
    }
  }
  return titles.get(spreadsheetId);
}

export function isOfflineError(message) {
  const text = String(message || "");
  if (isSheetPermissionError(text)) return false;
  if (/failed \((400|401|403|404)\)/.test(text)) return false;
  if (text === SHEET_RATE_LIMIT || /failed \(429\)|rateLimitExceeded|RESOURCE_EXHAUSTED/i.test(text)) return true;
  return /ENOTFOUND|EAI_AGAIN|ENETUNREACH|ECONNRESET|ECONNREFUSED|ETIMEDOUT|EHOSTUNREACH|EPIPE|fetch failed|socket hang up|network|offline|failed \(no status\)|failed \(502\)|failed \(503\)|failed \(504\)/i.test(
    text,
  );
}

/** A dropped sheet read stays on the sync line. A waiting queue keeps its existing status. */
export function sheetOfflineNote(message, pending = false) {
  if (!isOfflineError(message)) return "";
  return pending ? "Waiting to sync" : "The student list could not be loaded. The computer is offline.";
}

export async function createGoogle(config, credentials = null) {
  if (credentials) {
    return new GoogleAuth({ credentials, scopes: SCOPES }).getClient();
  }
  const keyFile = config.serviceAccountJson;
  if (!keyFile) {
    throw new Error(
      "Missing service account JSON path. Set GOOGLE_SERVICE_ACCOUNT_JSON or serviceAccountJson in attendance.config.json.",
    );
  }

  let parsed;
  try {
    parsed = JSON.parse(await readFile(keyFile, "utf8"));
  } catch {
    throw new Error(`Cannot read service account JSON at ${keyFile}. Check the file and permissions.`);
  }
  if (!parsed.client_email || !parsed.private_key) {
    throw new Error(`Service account JSON at ${keyFile} is missing client_email or private_key.`);
  }

  const auth = new GoogleAuth({ keyFile, scopes: SCOPES });
  return auth.getClient();
}

async function grequest(client, opts) {
  const method = opts.method ?? "GET";
  if (method === "GET" && Date.now() < readsPausedUntil) throw new Error(SHEET_RATE_LIMIT);
  try {
    const res = await client.request(opts);
    return res.data;
  } catch (err) {
    const status = err.response?.status;
    if (status === 429) {
      readsPausedUntil = Date.now() + READ_PAUSE_MS;
      throw new Error(SHEET_RATE_LIMIT);
    }
    const body = err.response?.data;
    const detail = typeof body === "string" ? body : JSON.stringify(body ?? err.message);
    throw new Error(
      `Google API ${method} ${opts.url} failed (${status ?? "no status"}): ${String(detail).slice(0, 500)}`,
    );
  }
}

function sheetsUrl(spreadsheetId, suffix) {
  return `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}${suffix}`;
}

function quoteTitle(title) {
  return `'${String(title).replaceAll("'", "''")}'`;
}

async function sheetTitle(client, spreadsheetId, sheetGid) {
  const sheets = await sheetProperties(client, spreadsheetId);
  const sheet = sheets.find((item) => item?.sheetId === Number(sheetGid));
  if (!sheet) throw new Error(`Sheet gid ${sheetGid} was not found.`);
  return sheet.title;
}

export async function getSheetGrid(client, spreadsheetId, sheetGid) {
  const title = await sheetTitle(client, spreadsheetId, sheetGid);
  const range = encodeURIComponent(`${quoteTitle(title)}!A:ZZ`);
  const data = await grequest(client, {
    url: sheetsUrl(spreadsheetId, `/values/${range}`),
  });
  return { title, rows: data.values ?? [] };
}

async function sheetMeta(client, spreadsheetId, sheetGid) {
  const meta = await grequest(client, {
    url: sheetsUrl(spreadsheetId, "?fields=sheets.properties(sheetId,title,gridProperties.rowCount)"),
  });
  const sheet = (meta.sheets || []).find((item) => item.properties?.sheetId === Number(sheetGid));
  if (!sheet) throw new Error(`Sheet gid ${sheetGid} was not found.`);
  return sheet.properties;
}

async function rowValues(client, spreadsheetId, title, row, render) {
  const range = encodeURIComponent(`${quoteTitle(title)}!${row}:${row}`);
  const data = await grequest(client, {
    url: sheetsUrl(spreadsheetId, `/values/${range}?valueRenderOption=${render}`),
  });
  return data.values?.[0] || [];
}

export async function getDateHeader(client, spreadsheetId, sheetGid) {
  const props = await sheetMeta(client, spreadsheetId, sheetGid);
  const [formatted, serials, formulas] = await Promise.all([
    rowValues(client, spreadsheetId, props.title, 1, "FORMATTED_VALUE"),
    rowValues(client, spreadsheetId, props.title, 1, "UNFORMATTED_VALUE"),
    rowValues(client, spreadsheetId, props.title, 2, "FORMULA"),
  ]);
  return {
    title: props.title,
    rowCount: props.gridProperties?.rowCount || formatted.length,
    formatted,
    formulas,
    serials: serials.map((value) => (typeof value === "number" ? value : null)),
  };
}

export async function insertDateColumn(client, spreadsheetId, sheetGid, plan) {
  const props = await sheetMeta(client, spreadsheetId, sheetGid);
  const source = encodeURIComponent(`${quoteTitle(props.title)}!${columnA1(plan.sourceIndex)}1`);
  const sourceCell = await grequest(client, {
    url: sheetsUrl(
      spreadsheetId,
      `?ranges=${source}&includeGridData=true&fields=sheets(properties.sheetId,data.rowData.values(userEnteredFormat.numberFormat))`,
    ),
  });
  const sourceSheet = (sourceCell.sheets || []).find((item) => item.properties?.sheetId === Number(sheetGid));
  const numberFormat = sourceSheet?.data?.[0]?.rowData?.[0]?.values?.[0]?.userEnteredFormat?.numberFormat;
  if (!numberFormat?.pattern) throw new Error("Date column has no number format to copy.");
  const rowCount = Math.max(props.gridProperties?.rowCount || 0, 3);
  const sheetId = props.sheetId;
  await grequest(client, {
    url: sheetsUrl(spreadsheetId, ":batchUpdate"),
    method: "POST",
    data: {
      requests: [
        {
          insertDimension: {
            range: {
              sheetId,
              dimension: "COLUMNS",
              startIndex: plan.insertIndex,
              endIndex: plan.insertIndex + 1,
            },
            inheritFromBefore: true,
          },
        },
        {
          updateCells: {
            start: { sheetId, rowIndex: 0, columnIndex: plan.insertIndex },
            rows: [
              {
                values: [
                  {
                    userEnteredValue: { numberValue: plan.serial },
                    userEnteredFormat: { numberFormat },
                  },
                ],
              },
            ],
            fields: "userEnteredValue,userEnteredFormat.numberFormat",
          },
        },
        {
          updateCells: {
            start: { sheetId, rowIndex: 1, columnIndex: plan.insertIndex },
            rows: [{ values: [{ userEnteredValue: { formulaValue: plan.formula } }] }],
            fields: "userEnteredValue",
          },
        },
        {
          copyPaste: {
            source: {
              sheetId,
              startRowIndex: 2,
              endRowIndex: rowCount,
              startColumnIndex: plan.sourceIndex,
              endColumnIndex: plan.sourceIndex + 1,
            },
            destination: {
              sheetId,
              startRowIndex: 2,
              endRowIndex: rowCount,
              startColumnIndex: plan.insertIndex,
              endColumnIndex: plan.insertIndex + 1,
            },
            pasteType: "PASTE_DATA_VALIDATION",
          },
        },
      ],
    },
  });
}

function columnA1(index) {
  let n = index + 1;
  let letters = "";
  while (n > 0) {
    const rem = (n - 1) % 26;
    letters = String.fromCharCode(65 + rem) + letters;
    n = Math.floor((n - 1) / 26);
  }
  return letters;
}

/** Header and row-2 formula only. Does not write a student cell. */
export async function ensureDateColumn(client, spreadsheetId, sheetGid, date) {
  const layout = await getDateHeader(client, spreadsheetId, sheetGid);
  const plan = planDateColumn(layout.formatted, layout.formulas, layout.serials, date);
  if (!plan || plan.op !== "insert") return { plan, inserted: false };
  await insertDateColumn(client, spreadsheetId, sheetGid, {
    ...plan,
    serial: sheetsSerial(date),
  });
  return { plan, inserted: true, title: layout.title };
}

/** Adds one row under the existing table. Does not change the header row. */
export async function appendSheetRow(client, spreadsheetId, sheetGid, values) {
  const title = await sheetTitle(client, spreadsheetId, sheetGid);
  const range = encodeURIComponent(`${quoteTitle(title)}!A:ZZ`);
  await grequest(client, {
    url: `${sheetsUrl(spreadsheetId, `/values/${range}:append`)}?valueInputOption=RAW&insertDataOption=INSERT_ROWS`,
    method: "POST",
    data: { values: [values] },
  });
  return title;
}

/** Delete every row under the header in one cut. Row 1 stays. lastRow is the last 1-based row. */
export async function clearSheetBelowHeader(client, spreadsheetId, sheetGid, lastRow) {
  const end = Number(lastRow);
  if (!(end > 1)) return;
  const props = await sheetMeta(client, spreadsheetId, sheetGid);
  await grequest(client, {
    url: sheetsUrl(spreadsheetId, ":batchUpdate"),
    method: "POST",
    data: {
      requests: [
        {
          deleteDimension: {
            range: {
              sheetId: props.sheetId,
              dimension: "ROWS",
              startIndex: 1,
              endIndex: end,
            },
          },
        },
      ],
    },
  });
}

/** Delete whole rows, highest first so earlier indexes stay put. */
export async function deleteSheetRows(client, spreadsheetId, sheetGid, rowNumbers) {
  const props = await sheetMeta(client, spreadsheetId, sheetGid);
  const rows = [...new Set(rowNumbers.map((row) => Number(row)).filter((row) => row > 1))].sort((a, b) => b - a);
  if (!rows.length) return props.title;
  await grequest(client, {
    url: sheetsUrl(spreadsheetId, ":batchUpdate"),
    method: "POST",
    data: {
      requests: rows.map((rowNumber) => ({
        deleteDimension: {
          range: {
            sheetId: props.sheetId,
            dimension: "ROWS",
            startIndex: rowNumber - 1,
            endIndex: rowNumber,
          },
        },
      })),
    },
  });
  return props.title;
}

/** The date-grid checkbox. Checked stores حاضر. Unchecked is an empty cell, so COUNTA skips it. */
export function attendanceCellUpdate(value) {
  const text = String(value ?? "");
  const cell = {
    dataValidation: {
      condition: {
        type: "BOOLEAN",
        values: [{ userEnteredValue: "حاضر" }],
      },
      strict: true,
      showCustomUi: true,
    },
  };
  if (text !== "") cell.userEnteredValue = { stringValue: text };
  return { cell, fields: "userEnteredValue,dataValidation" };
}

function a1Start(a1) {
  const match = /^([A-Z]+)(\d+)$/.exec(String(a1 || "").toUpperCase());
  if (!match) throw new Error(`Not a single cell: ${a1}`);
  let column = 0;
  for (const ch of match[1]) column = column * 26 + (ch.charCodeAt(0) - 64);
  return { columnIndex: column - 1, rowIndex: Number(match[2]) - 1 };
}

async function sheetIdByTitle(client, spreadsheetId, title) {
  const sheets = await sheetProperties(client, spreadsheetId);
  const sheet = sheets.find((item) => item?.title === title);
  if (!sheet) throw new Error(`Sheet ${title} was not found.`);
  return sheet.sheetId;
}

/** One date cell. Puts the حاضر checkbox back in the same write that sets or clears the value. */
export async function writeAttendanceCell(client, spreadsheetId, sheetTitle, a1, value) {
  const sheetId = await sheetIdByTitle(client, spreadsheetId, sheetTitle);
  const start = a1Start(a1);
  const { cell, fields } = attendanceCellUpdate(value);
  await grequest(client, {
    url: sheetsUrl(spreadsheetId, ":batchUpdate"),
    method: "POST",
    data: {
      requests: [
        {
          updateCells: {
            start: { sheetId, rowIndex: start.rowIndex, columnIndex: start.columnIndex },
            rows: [{ values: [cell] }],
            fields,
          },
        },
      ],
    },
  });
}

/** Log cells only. An empty attendance cell must not come through here: values.clear deletes the checkbox. */
export async function writeSheetCell(client, spreadsheetId, sheetTitle, a1, value) {
  if (String(value ?? "") === "") {
    const range = encodeURIComponent(`${quoteTitle(sheetTitle)}!${a1}`);
    await grequest(client, {
      url: `${sheetsUrl(spreadsheetId, `/values/${range}:clear`)}`,
      method: "POST",
      data: {},
    });
    return;
  }
  await writeSheetValues(client, spreadsheetId, sheetTitle, a1, [[value]]);
}

export async function writeSheetValues(client, spreadsheetId, sheetTitle, a1, values) {
  const range = encodeURIComponent(`${quoteTitle(sheetTitle)}!${a1}`);
  await grequest(client, {
    url: `${sheetsUrl(spreadsheetId, `/values/${range}`)}?valueInputOption=RAW`,
    method: "PUT",
    data: { values },
  });
}
