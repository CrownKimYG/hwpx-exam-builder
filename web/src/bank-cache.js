import {
  DEFAULT_BANK_RULE_ID,
  fileAnalysisCacheKey,
} from "./bank-cache-model.js";

const DATABASE_NAME = "hwpx-exam-builder-bank-cache";
const DATABASE_VERSION = 1;
const PROFILE_STORE = "bankProfiles";
const FILE_STORE = "fileAnalyses";

let databasePromise = null;

function requestResult(request) {
  return new Promise((resolve, reject) => {
    request.addEventListener("success", () => resolve(request.result), { once: true });
    request.addEventListener("error", () => reject(request.error || new Error("브라우저 캐시 요청이 실패했습니다.")), { once: true });
  });
}

function transactionDone(transaction) {
  return new Promise((resolve, reject) => {
    transaction.addEventListener("complete", () => resolve(), { once: true });
    transaction.addEventListener("abort", () => reject(transaction.error || new Error("브라우저 캐시 작업이 중단되었습니다.")), { once: true });
    transaction.addEventListener("error", () => reject(transaction.error || new Error("브라우저 캐시 작업이 실패했습니다.")), { once: true });
  });
}

export function bankCacheAvailable() {
  return typeof indexedDB !== "undefined";
}

async function openDatabase() {
  if (!bankCacheAvailable()) return null;
  if (!databasePromise) {
    databasePromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
      request.addEventListener("upgradeneeded", () => {
        const database = request.result;
        if (!database.objectStoreNames.contains(PROFILE_STORE)) {
          const profiles = database.createObjectStore(PROFILE_STORE, { keyPath: "bankId" });
          profiles.createIndex("rootFolderName", "rootFolderName", { unique: false });
        }
        if (!database.objectStoreNames.contains(FILE_STORE)) {
          const files = database.createObjectStore(FILE_STORE, { keyPath: "cacheKey" });
          files.createIndex("bankId", "bankId", { unique: false });
        }
      });
      request.addEventListener("success", () => resolve(request.result), { once: true });
      request.addEventListener("error", () => reject(request.error || new Error("브라우저 캐시를 열지 못했습니다.")), { once: true });
      request.addEventListener("blocked", () => reject(new Error("다른 탭에서 브라우저 캐시를 사용 중입니다.")), { once: true });
    });
  }
  return databasePromise;
}

export async function listBankProfiles() {
  const database = await openDatabase();
  if (!database) return [];
  const transaction = database.transaction(PROFILE_STORE, "readonly");
  const done = transactionDone(transaction);
  const result = await requestResult(transaction.objectStore(PROFILE_STORE).getAll());
  await done;
  return result.sort((left, right) => String(right.lastOpenedAt || "").localeCompare(String(left.lastOpenedAt || "")));
}

export async function saveBankProfile(profile) {
  const database = await openDatabase();
  if (!database) return profile;
  const transaction = database.transaction(PROFILE_STORE, "readwrite");
  const done = transactionDone(transaction);
  transaction.objectStore(PROFILE_STORE).put(profile);
  await done;
  return profile;
}

export async function getCachedFileAnalysis(bankId, identity, ruleId = DEFAULT_BANK_RULE_ID) {
  const database = await openDatabase();
  if (!database) return null;
  const cacheKey = fileAnalysisCacheKey(bankId, identity, ruleId);
  const transaction = database.transaction(FILE_STORE, "readonly");
  const done = transactionDone(transaction);
  const result = await requestResult(transaction.objectStore(FILE_STORE).get(cacheKey));
  await done;
  return result || null;
}

export async function saveCachedFileAnalysis({ bankId, identity, ruleId = DEFAULT_BANK_RULE_ID, analysis, normalizedBytes = null }) {
  const database = await openDatabase();
  if (!database || !analysis) return null;
  const record = {
    cacheKey: fileAnalysisCacheKey(bankId, identity, ruleId),
    bankId,
    identity,
    ruleId,
    analysis,
    normalizedBytes: normalizedBytes ? Uint8Array.from(normalizedBytes).buffer : null,
    savedAt: new Date().toISOString(),
  };
  const transaction = database.transaction(FILE_STORE, "readwrite");
  const done = transactionDone(transaction);
  transaction.objectStore(FILE_STORE).put(record);
  await done;
  return record;
}

export async function countCachedFiles(bankId) {
  const database = await openDatabase();
  if (!database) return 0;
  const transaction = database.transaction(FILE_STORE, "readonly");
  const done = transactionDone(transaction);
  const result = await requestResult(transaction.objectStore(FILE_STORE).index("bankId").count(bankId));
  await done;
  return result;
}

export async function listCachedFileAnalyses(bankId) {
  const database = await openDatabase();
  if (!database) return [];
  const transaction = database.transaction(FILE_STORE, "readonly");
  const done = transactionDone(transaction);
  const result = [];
  const request = transaction.objectStore(FILE_STORE).index("bankId").openKeyCursor(IDBKeyRange.only(bankId));
  request.addEventListener("success", () => {
    const cursor = request.result;
    if (!cursor) return;
    const [cachedBankId, ruleId, analysisVersion, relativePath, size, lastModified] = String(cursor.primaryKey).split("\u0001");
    result.push({
      cacheKey: cursor.primaryKey,
      bankId: cachedBankId,
      ruleId,
      analysisVersion: Number(analysisVersion),
      identity: {
        name: relativePath.split("/").at(-1),
        relativePath,
        size: Number(size),
        lastModified: Number(lastModified),
      },
    });
    cursor.continue();
  });
  await done;
  return result
    .sort((left, right) => String(left.identity?.relativePath || "").localeCompare(
      String(right.identity?.relativePath || ""),
      "ko",
      { numeric: true, sensitivity: "base" },
    ));
}

export async function clearBankFileAnalyses(bankId) {
  const database = await openDatabase();
  if (!database) return;
  const transaction = database.transaction(FILE_STORE, "readwrite");
  const done = transactionDone(transaction);
  const index = transaction.objectStore(FILE_STORE).index("bankId");
  const request = index.openKeyCursor(IDBKeyRange.only(bankId));
  request.addEventListener("success", () => {
    const cursor = request.result;
    if (!cursor) return;
    transaction.objectStore(FILE_STORE).delete(cursor.primaryKey);
    cursor.continue();
  });
  await done;
}

export async function pruneBankFileAnalyses(bankId, validKeys) {
  const database = await openDatabase();
  if (!database) return;
  const keep = new Set(validKeys);
  const transaction = database.transaction(FILE_STORE, "readwrite");
  const done = transactionDone(transaction);
  const store = transaction.objectStore(FILE_STORE);
  const request = store.index("bankId").openKeyCursor(IDBKeyRange.only(bankId));
  request.addEventListener("success", () => {
    const cursor = request.result;
    if (!cursor) return;
    if (!keep.has(cursor.primaryKey)) store.delete(cursor.primaryKey);
    cursor.continue();
  });
  await done;
}

export async function deleteBankProfile(bankId) {
  const database = await openDatabase();
  if (!database) return;
  const transaction = database.transaction([PROFILE_STORE, FILE_STORE], "readwrite");
  const done = transactionDone(transaction);
  transaction.objectStore(PROFILE_STORE).delete(bankId);
  const fileStore = transaction.objectStore(FILE_STORE);
  const request = fileStore.index("bankId").openKeyCursor(IDBKeyRange.only(bankId));
  request.addEventListener("success", () => {
    const cursor = request.result;
    if (!cursor) return;
    fileStore.delete(cursor.primaryKey);
    cursor.continue();
  });
  await done;
}

export async function requestPersistentBankCache() {
  try {
    if (!navigator.storage?.persist) return false;
    return await navigator.storage.persist();
  } catch {
    return false;
  }
}
