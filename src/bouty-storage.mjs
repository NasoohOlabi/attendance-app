import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

async function atomicWrite(file, bytes) {
  await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  const temporary = `${file}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, bytes, { flag: "wx", mode: 0o600 });
    await rename(temporary, file);
  } finally {
    await rm(temporary, { force: true });
  }
}

/** Credentials are encrypted with the same Windows account as the app. */
export function createBoutyCredentials({ file, encryption, platform = process.platform }) {
  async function available() {
    if (platform !== "win32" || !await encryption.isAsyncEncryptionAvailable()) throw new Error("Windows secure storage is unavailable.");
  }
  async function save(account) {
    if (!account || typeof account.username !== "string" || !account.username.trim() || typeof account.password !== "string" || !account.password) throw new Error("Enter the Bouty username and password.");
    await available();
    const encrypted = await encryption.encryptStringAsync(JSON.stringify({ username: account.username.trim(), password: account.password }));
    await atomicWrite(file, encrypted);
  }
  return {
    save,
    async read() {
      let bytes;
      try { bytes = await readFile(file); } catch (err) { if (err.code === "ENOENT") return null; throw err; }
      await available();
      try {
        const decrypted = await encryption.decryptStringAsync(bytes);
        const account = JSON.parse(decrypted.result);
        if (typeof account.username !== "string" || !account.username.trim() || typeof account.password !== "string" || !account.password) throw new Error();
        if (decrypted.shouldReEncrypt) await save(account);
        return account;
      } catch { throw new Error("The saved Bouty account cannot be opened by this Windows user."); }
    },
  };
}

/** Serializes updates so a scan arriving during sync cannot be lost. */
export function createBoutyQueue(file) {
  let tail = Promise.resolve();
  function serial(fn) {
    const run = tail.then(fn, fn);
    tail = run.catch(() => {});
    return run;
  }
  async function read() {
    let raw;
    try { raw = await readFile(file, "utf8"); } catch (err) { if (err.code === "ENOENT") return []; throw err; }
    const data = JSON.parse(raw);
    if (!Array.isArray(data.items)) throw new Error("The Bouty queue is invalid.");
    return data.items;
  }
  async function write(items) { await atomicWrite(file, JSON.stringify({ items })); }
  return {
    list: () => serial(read),
    enqueue: (item) => serial(async () => {
      const items = await read();
      if (!items.some((existing) => existing.id === item.id)) { items.push(item); await write(items); }
    }),
    remove: (id) => serial(async () => { const items = await read(); await write(items.filter((item) => item.id !== id)); }),
  };
}
