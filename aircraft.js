import { openStep2Database, requestResult, transactionDone } from "./db.js";
import { calculateAircraftTotalFlightMinutes } from "./flightTime.js";

const $ = id => document.getElementById(id);
let db;

function uuidV4() {
  if (crypto.randomUUID) return crypto.randomUUID();
  if (!crypto.getRandomValues) throw new Error("安全なIDを生成できません。このブラウザでは登録できません。");
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map(v => v.toString(16).padStart(2, "0"));
  return `${hex.slice(0,4).join("")}-${hex.slice(4,6).join("")}-${hex.slice(6,8).join("")}-${hex.slice(8,10).join("")}-${hex.slice(10).join("")}`;
}

function showMessage(message, isError = true) {
  $("formMessage").textContent = message;
  $("formMessage").style.color = isError ? "#9b3b2f" : "#286044";
}

function showEditor(editing = false) {
  $("editorPanel").hidden = false;
  $("editorTitle").textContent = editing ? "機体を編集" : "機体を登録";
  $("editReasonWrap").hidden = !editing;
  $("formMessage").textContent = "";
  $("editorPanel").scrollIntoView({ behavior: "smooth", block: "start" });
}

function closeEditor() {
  $("aircraftForm").reset();
  $("aircraftId").value = "";
  $("totalHours").value = "0";
  $("totalMinutes").value = "0";
  $("aircraftCertificationFields").hidden = true;
  $("aircraftCertificationClass").required = false;
  $("aircraftCertificationNumber").required = false;
  $("editorPanel").hidden = true;
  $("formMessage").textContent = "";
}

function updateCertificationFields() {
  const isCertified = $("hasAircraftCertification").value === "true";
  $("aircraftCertificationFields").hidden = !isCertified;
  $("aircraftCertificationClass").required = isCertified;
  $("aircraftCertificationNumber").required = isCertified;
  if (!isCertified) {
    $("aircraftCertificationClass").value = "";
    $("aircraftCertificationNumber").value = "";
  }
}

function minutesFromForm() {
  const hoursRaw = $("totalHours").value;
  const minutesRaw = $("totalMinutes").value;
  if (hoursRaw === "" || minutesRaw === "") throw new Error("総飛行時間の時間と分を入力してください。");
  const hours = Number(hoursRaw);
  const minutes = Number(minutesRaw);
  if (!Number.isSafeInteger(hours) || hours < 0) throw new Error("時間は0以上の整数で入力してください。");
  if (!Number.isInteger(minutes) || minutes < 0 || minutes > 59) throw new Error("分は0〜59で入力してください。");
  const total = hours * 60 + minutes;
  if (!Number.isSafeInteger(total)) throw new Error("総飛行時間が大きすぎます。");
  return total;
}

function collectFormData() {
  const certificationValue = $("hasAircraftCertification").value;
  if (certificationValue !== "true" && certificationValue !== "false") {
    throw new Error("機体認証の有無を選択してください。");
  }
  const certified = certificationValue === "true";
  const data = {
    name: $("name").value.trim(),
    registrationMark: $("registrationMark").value.trim(),
    aircraftType: $("aircraftType").value.trim(),
    model: $("model").value.trim(),
    typeCertificationNumber: $("typeCertificationNumber").value.trim(),
    hasAircraftCertification: certified,
    aircraftCertificationClass: certified ? $("aircraftCertificationClass").value.trim() : "",
    aircraftCertificationNumber: certified ? $("aircraftCertificationNumber").value.trim() : "",
    manufacturer: $("manufacturer").value.trim(),
    serialNumber: $("serialNumber").value.trim(),
    remoteIdType: $("remoteIdType").value.trim(),
    initialTotalFlightMinutes: minutesFromForm(),
    notes: $("notes").value.trim(),
    status: $("status").value
  };

  for (const field of ["name", "registrationMark", "manufacturer", "serialNumber"]) {
    if (!data[field]) throw new Error("必須項目を入力してください。");
  }
  if (certified && (!data.aircraftCertificationClass || !data.aircraftCertificationNumber)) {
    throw new Error("機体認証が「あり」の場合、区分と番号を入力してください。");
  }
  if (!["使用中", "使用停止"].includes(data.status)) throw new Error("使用状態が正しくありません。");
  return data;
}

function comparableAircraft(record) {
  const fields = [
    "name", "registrationMark", "aircraftType", "model", "typeCertificationNumber",
    "hasAircraftCertification", "aircraftCertificationClass", "aircraftCertificationNumber",
    "manufacturer", "serialNumber", "remoteIdType", "initialTotalFlightMinutes", "notes", "status"
  ];
  return Object.fromEntries(fields.map(field => [field, record[field] ?? (field === "hasAircraftCertification" ? false : "")]));
}

function sameData(a, b) {
  return JSON.stringify(comparableAircraft(a)) === JSON.stringify(comparableAircraft(b));
}

async function countFlightsForAircraft(tx, aircraftId) {
  return requestResult(
    tx.objectStore("flightRecords").index("aircraftId").count(IDBKeyRange.only(aircraftId))
  );
}

function createTransactionWaiter(tx, getFailureReason = () => "") {
  const waiter = new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(new Error(getFailureReason() || tx.error?.message || "データベース処理を取り消しました。"));
    tx.onerror = () => reject(new Error(getFailureReason() || tx.error?.message || "データベース処理に失敗しました。"));
  });
  waiter.catch(() => {});
  return waiter;
}

async function saveAircraft(event) {
  event.preventDefault();
  try {
    const formData = collectFormData();
    const id = $("aircraftId").value;
    const now = new Date().toISOString();

    if (!id) {
      const record = {
        id: uuidV4(),
        ...formData,
        revision: 1,
        createdAt: now,
        updatedAt: now
      };
      const tx = db.transaction(["aircraft"], "readwrite");
      tx.objectStore("aircraft").add(record);
      await transactionDone(tx);
      var saveResultMessage = "機体を登録しました。";
    } else {
      const readTx = db.transaction(["aircraft"], "readonly");
      const current = await requestResult(readTx.objectStore("aircraft").get(id));
      await transactionDone(readTx);
      if (!current) throw new Error("編集対象の機体が見つかりません。");

      const proposed = { ...current, ...formData };
      if (sameData(current, proposed)) {
        showMessage("変更箇所がありません。保存・履歴追加・更新日時の変更は行いません。", false);
        return;
      }

      const initialTotalChanged = current.initialTotalFlightMinutes !== formData.initialTotalFlightMinutes;
      let confirmedWithFlights = false;
      if (initialTotalChanged) {
        const countTx = db.transaction(["flightRecords"], "readonly");
        const flightCount = await countFlightsForAircraft(countTx, id);
        await transactionDone(countTx);
        if (flightCount > 0) {
          confirmedWithFlights = window.confirm("この機体には飛行記録があります。登録時点の総飛行時間を変更すると、表示される総飛行時間も変わります。変更しますか？");
          if (!confirmedWithFlights) return;
        }
      }

      const history = {
        id: uuidV4(),
        recordType: "aircraft",
        recordId: id,
        previousRevision: current.revision,
        beforeData: structuredClone(current),
        editedAt: now,
        editReason: $("editReason").value.trim()
      };
      const updated = {
        ...current,
        ...formData,
        revision: current.revision + 1,
        updatedAt: now
      };

      const tx = db.transaction(["aircraft", "editHistories", "flightRecords"], "readwrite");
      let saveFailureReason = "";
      const done = createTransactionWaiter(tx, () => saveFailureReason);
      if (initialTotalChanged) {
        const flightCount = await countFlightsForAircraft(tx, id);
        if (flightCount > 0 && !confirmedWithFlights) {
          saveFailureReason = "保存時に飛行記録が確認されました。初期総飛行時間の変更について、もう一度確認してください。";
          tx.abort();
          try { await done; } catch (_) {}
          throw new Error(saveFailureReason);
        }
      }
      tx.objectStore("editHistories").add(history);
      tx.objectStore("aircraft").put(updated);
      await done;
      var saveResultMessage = "機体情報を更新し、編集履歴を保存しました。";
    }

    await renderAircraft();
    closeEditor();
    $("dbStatus").textContent = saveResultMessage;
  } catch (error) {
    showMessage(error.message || "保存に失敗しました。");
  }
}

async function renderAircraft() {
  const aircraftTx = db.transaction(["aircraft"], "readonly");
  const records = await requestResult(aircraftTx.objectStore("aircraft").getAll());
  await transactionDone(aircraftTx);
  records.sort((a, b) => (a.name || "").localeCompare(b.name || "", "ja"));
  const list = $("aircraftList");
  list.replaceChildren();
  $("emptyMessage").hidden = records.length !== 0;

  for (const record of records) {
    const flightsTx = db.transaction(["flightRecords"], "readonly");
    const flightRecords = await requestResult(flightsTx.objectStore("flightRecords").getAll());
    await transactionDone(flightsTx);
    const totalMinutes = calculateAircraftTotalFlightMinutes(
      record,
      flightRecords.filter(item => item.aircraftId === record.id)
    );

    const card = document.createElement("article");
    card.className = "aircraft-card";
    const info = document.createElement("div");
    const title = document.createElement("h3");
    title.textContent = record.name;
    const badge = document.createElement("span");
    badge.className = "badge" + (record.status === "使用停止" ? " stopped" : "");
    badge.textContent = record.status;
    title.append(" ", badge);
    const meta = document.createElement("div");
    meta.className = "card-meta";
    meta.textContent = `登録記号：${record.registrationMark}｜製造番号：${record.serialNumber}｜総飛行時間：${formatMinutes(totalMinutes)}`;
    info.append(title, meta);

    const actions = document.createElement("div");
    actions.className = "card-actions";
    const editButton = document.createElement("button");
    editButton.className = "subtle";
    editButton.textContent = "編集";
    editButton.addEventListener("click", () => beginEdit(record));
    const deleteButton = document.createElement("button");
    deleteButton.className = "subtle";
    deleteButton.textContent = "削除";
    deleteButton.addEventListener("click", () => deleteAircraft(record));
    actions.append(editButton, deleteButton);
    card.append(info, actions);
    list.append(card);
  }
}

function formatMinutes(total) {
  const value = Number(total) || 0;
  return `${Math.floor(value / 60)}時間${value % 60}分`;
}

async function beginEdit(record) {
  $("aircraftId").value = record.id;
  for (const id of [
    "name", "registrationMark", "aircraftType", "model", "typeCertificationNumber",
    "aircraftCertificationClass", "aircraftCertificationNumber", "manufacturer",
    "serialNumber", "remoteIdType", "notes", "status"
  ]) $(id).value = record[id] ?? "";
  $("hasAircraftCertification").value = String(Boolean(record.hasAircraftCertification));
  $("totalHours").value = String(Math.floor(record.initialTotalFlightMinutes / 60));
  $("totalMinutes").value = String(record.initialTotalFlightMinutes % 60);
  $("editReason").value = "";
  updateCertificationFields();
  showEditor(true);
}

async function deleteAircraft(record) {
  const confirmed = window.confirm(`「${record.name}」を削除します。\n飛行記録・不具合がない場合に限り削除できます。\n関連する編集履歴も同時に削除します。\nこの操作は元に戻せません。よろしいですか？`);
  if (!confirmed) return;

  try {
    if (db.objectStoreNames.contains("defects")) {
      throw new Error("不具合の保存領域が存在するため、機体の削除を停止しました。");
    }

    if (!db.objectStoreNames.contains("flightRecords")) {
      throw new Error("飛行記録の保存領域が見つかりません。安全のため機体の削除を停止しました。");
    }

    const tx = db.transaction(
      ["aircraft", "editHistories", "flightRecords"],
      "readwrite"
    );
    const done = transactionDone(tx);
    const aircraftStore = tx.objectStore("aircraft");
    const histories = tx.objectStore("editHistories");
    const flightRecords = tx.objectStore("flightRecords");

    const currentRequest = aircraftStore.get(record.id);
    const flightCountRequest = flightRecords.index("aircraftId").count(
      IDBKeyRange.only(record.id)
    );

    const [current, flightCount] = await Promise.all([
      requestResult(currentRequest),
      requestResult(flightCountRequest)
    ]);

    if (!current) {
      await done;
      throw new Error("削除対象の機体が見つかりません。");
    }

    if (flightCount > 0) {
      await done;
      throw new Error("この機体に紐づく飛行記録が存在するため、削除できません。");
    }

    aircraftStore.delete(record.id);

    const cursorRequest = histories.index("recordId").openCursor(
      IDBKeyRange.only(record.id)
    );
    cursorRequest.onsuccess = () => {
      const cursor = cursorRequest.result;
      if (cursor) {
        cursor.delete();
        cursor.continue();
      }
    };

    await done;
    await renderAircraft();
    $("dbStatus").textContent = "機体と関連する編集履歴を削除しました。";
  } catch (error) {
    $("dbStatus").textContent = error.message || "削除に失敗しました。";
  }
}

async function initialize() {
  try {
    db = await openStep2Database();
    $("dbStatus").textContent = `STEP2データベース準備完了｜${db.name}｜DBバージョン ${db.version}`;
    await renderAircraft();
  } catch (error) {
    $("dbStatus").textContent = `準備エラー：${error.message}`;
    $("newAircraftButton").disabled = true;
  }
}

$("newAircraftButton").addEventListener("click", () => {
  $("aircraftForm").reset();
  $("aircraftId").value = "";
  $("totalHours").value = "0";
  $("totalMinutes").value = "0";
  $("status").value = "使用中";
  $("hasAircraftCertification").value = "";
  updateCertificationFields();
  showEditor(false);
});
$("closeEditorButton").addEventListener("click", closeEditor);
$("cancelEditButton").addEventListener("click", closeEditor);
$("hasAircraftCertification").addEventListener("change", updateCertificationFields);
$("aircraftForm").addEventListener("submit", saveAircraft);

initialize();

if ("serviceWorker" in navigator && location.protocol.startsWith("http")) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js").catch(error => {
      console.warn("確認用Service Workerの登録に失敗しました。", error);
    });
  });
}
