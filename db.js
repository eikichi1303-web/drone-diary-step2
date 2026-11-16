const DB_NAME = "DroneDiaryStep2DB";
const REQUIRED_STORES = ["aircraft", "editHistories", "pilots"];

function createMissingStores(db, transaction) {
  if (!db.objectStoreNames.contains("aircraft")) {
    const store = db.createObjectStore("aircraft", { keyPath: "id" });
    store.createIndex("status", "status", { unique: false });
  } else if (!transaction.objectStore("aircraft").indexNames.contains("status")) {
    transaction.objectStore("aircraft").createIndex("status", "status", { unique: false });
  }

  if (!db.objectStoreNames.contains("editHistories")) {
    const store = db.createObjectStore("editHistories", { keyPath: "id" });
    store.createIndex("recordId", "recordId", { unique: false });
  } else if (!transaction.objectStore("editHistories").indexNames.contains("recordId")) {
    transaction.objectStore("editHistories").createIndex("recordId", "recordId", { unique: false });
  }

  if (!db.objectStoreNames.contains("pilots")) {
    const store = db.createObjectStore("pilots", { keyPath: "id" });
    store.createIndex("status", "status", { unique: false });
  } else if (!transaction.objectStore("pilots").indexNames.contains("status")) {
    transaction.objectStore("pilots").createIndex("status", "status", { unique: false });
  }
}

function openAtVersion(version) {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, version);
    request.onupgradeneeded = () => {
      createMissingStores(request.result, request.transaction);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("データベースを開けませんでした。"));
    request.onblocked = () => reject(new Error("別の画面がデータベースを使用中です。ほかの確認用画面を閉じてください。"));
  });
}

function attachVersionChangeHandler(db) {
  db.onversionchange = () => {
    // 他の画面からDBのバージョン更新要求を受けた接続は、自分で閉じる。
    db.close();

    // 機体管理・操縦者管理の両ページにある共通表示先を使用する。
    const status = document.getElementById("dbStatus");
    if (status) {
      status.textContent = "データベースが更新されました。ページを再読み込みしてください";
    }
  };
  return db;
}

export async function openStep2Database() {
  if (!("indexedDB" in window)) throw new Error("このブラウザはIndexedDBに対応していません。");

  // バージョン指定なしで開き、端末側の現在のバージョンを確認する。
  let db = await new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME);
    request.onupgradeneeded = () => {
      // 新規作成時は初期バージョン1で必要な保存領域を作る。
      createMissingStores(request.result, request.transaction);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("データベースを開けませんでした。"));
    request.onblocked = () => reject(new Error("別の画面がデータベースを使用中です。"));
  });

  const missingStore = REQUIRED_STORES.some(name => !db.objectStoreNames.contains(name));
  const hasMissingIndex =
    (db.objectStoreNames.contains("aircraft") &&
      !db.transaction(["aircraft"], "readonly").objectStore("aircraft").indexNames.contains("status")) ||
    (db.objectStoreNames.contains("editHistories") &&
      !db.transaction(["editHistories"], "readonly").objectStore("editHistories").indexNames.contains("recordId")) ||
    (db.objectStoreNames.contains("pilots") &&
      !db.transaction(["pilots"], "readonly").objectStore("pilots").indexNames.contains("status"));

  if (missingStore || hasMissingIndex) {
    const nextVersion = db.version + 1; // 端末側の版番号を下げず、必要な場合だけ1上げる。
    db.close();
    // この途中接続にはonversionchangeを設定しない。
    db = await openAtVersion(nextVersion);
  }

  const missingAfterUpgrade = REQUIRED_STORES.filter(name => !db.objectStoreNames.contains(name));
  if (missingAfterUpgrade.length) {
    db.close();
    throw new Error("必要な保存領域を準備できませんでした: " + missingAfterUpgrade.join(", "));
  }

  // 既存ストアの主キーは変更しない。想定と異なる場合は安全のため停止する。
  const checkTx = db.transaction(REQUIRED_STORES, "readonly");
  for (const name of REQUIRED_STORES) {
    if (checkTx.objectStore(name).keyPath !== "id") {
      db.close();
      throw new Error(`${name}の主キーが想定（id）と異なります。データを変更せず停止しました。`);
    }
  }

  // 検査・必要な版更新を終えた最終接続にだけ設定する。
  return attachVersionChangeHandler(db);
}

export function requestResult(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("データベース処理に失敗しました。"));
  });
}

export function transactionDone(transaction) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error || new Error("処理を取り消しました。"));
    transaction.onerror = () => reject(transaction.error || new Error("データベース処理に失敗しました。"));
  });
}
