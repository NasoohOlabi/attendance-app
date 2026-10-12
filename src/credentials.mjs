import { createPrivateKey, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";

export function credentialFile(fingerprintDir) {
  return path.join(path.dirname(fingerprintDir), "config", "service-account.enc");
}

function parseAccount(text) {
  let account;
  try {
    account = JSON.parse(text);
    if (account?.type !== "service_account" || !/^\S+@\S+\.\S+$/.test(account.client_email || "")) throw new Error();
    const key = createPrivateKey(account.private_key);
    if (key.asymmetricKeyType !== "rsa" || key.asymmetricKeyDetails.modulusLength < 2048) throw new Error();
  } catch {
    throw new Error("Choose a valid Google service-account JSON file with its private key.");
  }
  // Authentication endpoints and unrelated imported fields cannot change the Google client.
  const credentials = { type: "service_account", client_email: account.client_email, private_key: account.private_key };
  for (const field of ["project_id", "private_key_id", "client_id"]) {
    if (typeof account[field] === "string") credentials[field] = account[field];
  }
  return credentials;
}

export function createCredentialStore({ file, encryption, platform = process.platform }) {
  let pending = Promise.resolve();
  function serial(task) {
    const result = pending.then(task);
    pending = result.catch(() => {});
    return result;
  }
  async function available() {
    if (platform !== "win32" || !await encryption.isAsyncEncryptionAvailable()) {
      throw new Error("Windows secure storage is unavailable. The account was not saved.");
    }
  }
  async function persist(credentials) {
    await available();
    let encrypted;
    try {
      encrypted = await encryption.encryptStringAsync(JSON.stringify(credentials));
    } catch {
      throw new Error("The service account could not be encrypted. The previous account was kept.");
    }
    await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
    const temporary = `${file}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporary, encrypted, { flag: "wx", mode: 0o600 });
      await rename(temporary, file);
    } finally {
      await rm(temporary, { force: true });
    }
  }
  return {
    file,
    importFile(source) {
      return serial(async () => {
        let text;
        try {
          const info = await stat(source);
          if (!info.isFile() || info.size > 64 * 1024) throw new Error();
          text = await readFile(source, "utf8");
          if (Buffer.byteLength(text) > 64 * 1024) throw new Error();
        } catch {
          throw new Error("Choose a readable service-account JSON file smaller than 64 KB.");
        }
        const credentials = parseAccount(text);
        await persist(credentials);
        return { email: credentials.client_email };
      });
    },
    read() {
      return serial(async () => {
        let encrypted;
        try {
          encrypted = await readFile(file);
        } catch (error) {
          if (error.code === "ENOENT") return null;
          throw new Error("The saved service account could not be read. Import it again.");
        }
        await available();
        let decrypted;
        let credentials;
        try {
          decrypted = await encryption.decryptStringAsync(encrypted);
          credentials = parseAccount(decrypted.result);
        } catch {
          throw new Error("The saved service account cannot be opened by this Windows user. Import it again.");
        }
        if (decrypted.shouldReEncrypt) await persist(credentials);
        return credentials;
      });
    },
  };
}
