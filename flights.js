import {
  openStep2Database,
  requestResult,
  transactionDone
} from "./db.js";
import {
  normalizeFlightMinutes,
  isValidFlightMinutes
} from "./flightTime.js";

const $ = id => document.getElementById(id);

let db;
let currentEditStatus = "下書き";
let flightActionInProgress = false;
let editStartedUpdatedAt = "";

const STATUS_LABELS = {
  "下書き": "一時保存",
  "飛行中": "飛行中"
  // 工程8で「完了」を追加する。
};

function displayStatus(status) {
  return STATUS_LABELS[status] || status;
}

function uuidV4() {
  if (crypto.randomUUID) return crypto.randomUUID();
  if (!crypto.getRandomValues) {
    throw new Error("安全なIDを生成できません。このブラウザでは登録できません。");
  }
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
  $("editorTitle").textContent = editing
    ? (currentEditStatus === "飛行中" ? "飛行中の記録を続ける" : "飛行記録の一時保存を編集")
    : "飛行記録の一時保存";
  $("formMessage").textContent = "";
  updateActionButtons();
  $("editorPanel").scrollIntoView({ behavior: "smooth", block: "start" });
}

function closeEditor() {
  $("flightForm").reset();
  $("flightId").value = "";
  currentEditStatus = "下書き";
  editStartedUpdatedAt = "";
  $("safetyDetailsFields").hidden = true;
  $("prohibitedAirspace").disabled = false;
  $("flightMethod").disabled = false;
  $("editorPanel").hidden = true;
  $("formMessage").textContent = "";
  updateActionButtons();
}

function updateSafetyFields() {
  const hasSafetyIssue = $("safetyIssue").value === "あり";
  $("safetyDetailsFields").hidden = !hasSafetyIssue;
  if (!hasSafetyIssue) {
    $("safetyDetails").value = "";
    $("aircraftCondition").value = "";
  }
}

function updateProhibitedAirspaceField() {
  const checked = $("prohibitedAirspaceNone").checked;
  $("prohibitedAirspace").disabled = checked;
  if (checked) $("prohibitedAirspace").value = "";
}

function updateFlightMethodField() {
  const checked = $("flightMethodNone").checked;
  $("flightMethod").disabled = checked;
  if (checked) $("flightMethod").value = "";
}

function updateActionButtons() {
  const hasFlightId = Boolean($("flightId").value);
  const isFlying = currentEditStatus === "飛行中";
  const aircraftOption = $("aircraftId").selectedOptions[0];
  const pilotOption = $("pilotId").selectedOptions[0];
  const activeSelections = aircraftOption?.dataset.status === "使用中" && pilotOption?.dataset.status === "使用中";
  $("takeoffButton").disabled = flightActionInProgress || isFlying || !$("aircraftId").value || !$("pilotId").value || !activeSelections;
  $("landingButton").disabled = flightActionInProgress || !hasFlightId || !isFlying;
  $("saveFlightButton").disabled = flightActionInProgress;
  $("takeoffButton").hidden = isFlying;
  $("landingButton").hidden = !isFlying;
  $("saveFlightButton").textContent = isFlying ? "保存する" : "一時保存する";
}

function japanDateTimeToUTC(value) {
  if (!value) return "";
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) {
    throw new Error("日時の入力形式が正しくありません。");
  }
  const date = new Date(value + ":00+09:00");
  if (Number.isNaN(date.getTime())) throw new Error("日時を正しく読み取れません。");
  return date.toISOString();
}

function utcToJapanDateTime(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const parts = new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23"
  }).formatToParts(date);
  const part = type => parts.find(item => item.type === type)?.value || "";
  return `${part("year")}-${part("month")}-${part("day")}T${part("hour")}:${part("minute")}`;
}

function formatJapanDateTime(value) {
  if (!value) return "未入力";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "日時不明";
  return new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23"
  }).format(date);
}

async function loadAircraftAndPilots(selectedAircraftId = "", selectedPilotId = "") {
  const tx = db.transaction(["aircraft", "pilots"], "readonly");
  const aircraftRequest = requestResult(tx.objectStore("aircraft").getAll());
  const pilotRequest = requestResult(tx.objectStore("pilots").getAll());
  const [aircraftRecords, pilotRecords] = await Promise.all([aircraftRequest, pilotRequest]);
  await transactionDone(tx);

  const aircraftSelect = $("aircraftId");
  const pilotSelect = $("pilotId");
  aircraftSelect.replaceChildren();
  pilotSelect.replaceChildren();
  aircraftSelect.add(new Option("選択してください", ""));
  pilotSelect.add(new Option("選択してください", ""));

  const availableAircraft = aircraftRecords.filter(record => record.status === "使用中");
  const availablePilots = pilotRecords.filter(record => record.status === "使用中");
  for (const record of availableAircraft) {
    const option = new Option(`${record.name}（${record.registrationMark || "登録記号なし"}）`, record.id);
    option.dataset.status = record.status;
    aircraftSelect.add(option);
  }
  for (const record of availablePilots) {
    const option = new Option(record.name, record.id);
    option.dataset.status = record.status;
    pilotSelect.add(option);
  }

  if (selectedAircraftId && !availableAircraft.some(record => record.id === selectedAircraftId)) {
    const stopped = aircraftRecords.find(record => record.id === selectedAircraftId);
    if (stopped) {
      const option = new Option(`${stopped.name}（使用停止）`, stopped.id);
      option.dataset.status = stopped.status;
      aircraftSelect.add(option);
    }
  }
  if (selectedPilotId && !availablePilots.some(record => record.id === selectedPilotId)) {
    const stopped = pilotRecords.find(record => record.id === selectedPilotId);
    if (stopped) {
      const option = new Option(`${stopped.name}（使用停止）`, stopped.id);
      option.dataset.status = stopped.status;
      pilotSelect.add(option);
    }
  }
  aircraftSelect.value = selectedAircraftId;
  pilotSelect.value = selectedPilotId;
  updateActionButtons();
}

function collectFormFields() {
  let prohibitedAirspace = $("prohibitedAirspace").value.trim();
  if ($("prohibitedAirspaceNone").checked) prohibitedAirspace = "該当なし";
  let flightMethod = $("flightMethod").value.trim();
  if ($("flightMethodNone").checked) flightMethod = "該当なし";
  const safetyIssue = $("safetyIssue").value;
  return {
    aircraftId: $("aircraftId").value,
    pilotId: $("pilotId").value,
    purpose: $("purpose").value.trim(),
    route: $("route").value.trim(),
    waypoints: $("waypoints").value.trim(),
    prohibitedAirspace,
    flightMethod,
    takeoffLocation: $("takeoffLocation").value.trim(),
    takeoffAt: japanDateTimeToUTC($("takeoffAt").value),
    landingLocation: $("landingLocation").value.trim(),
    landingAt: japanDateTimeToUTC($("landingAt").value),
    safetyIssue,
    safetyDetails: safetyIssue === "あり" ? $("safetyDetails").value.trim() : "",
    aircraftCondition: safetyIssue === "あり" ? $("aircraftCondition").value.trim() : "",
    specialNotes: $("specialNotes").value.trim()
  };
}

function collectFlightTimeFields() {
  const raw = $("flightMinutesInput").value.trim();
  if (raw === "") {
    return { flightMinutes: null, manuallyAdjusted: false };
  }

  if (!/^\d+$/.test(raw)) {
    throw new Error("整数で入力してください（0は1分として保存されます）");
  }

  const value = Number(raw);
  if (!Number.isSafeInteger(value)) {
    throw new Error("整数で入力してください（0は1分として保存されます）");
  }

  const normalized = normalizeFlightMinutes(value);
  if (!isValidFlightMinutes(normalized)) {
    throw new Error("整数で入力してください（0は1分として保存されます）");
  }

  return { flightMinutes: normalized, manuallyAdjusted: true };
}

function newRecord(fields, status, now) {
  return {
    id: uuidV4(), ...fields,
    aircraftSnapshot: null, pilotSnapshot: null,
    flightMinutes: null, status, manuallyAdjusted: false,
    revision: 1, createdAt: now, updatedAt: now,
    completedAt: "", cancelledAt: "", cancelReason: ""
  };
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

async function saveFlight(event) {
  event.preventDefault();
  if (flightActionInProgress) return;
  flightActionInProgress = true;
  updateActionButtons();
  let done;
  try {
    const fields = collectFormFields();
    const flightTimeFields = collectFlightTimeFields();
    const id = $("flightId").value;
    const now = new Date().toISOString();
    if (!id) {
      const record = newRecord(fields, "下書き", now);
      record.flightMinutes = flightTimeFields.flightMinutes;
      record.manuallyAdjusted = flightTimeFields.manuallyAdjusted;
      const tx = db.transaction(["flightRecords"], "readwrite");
      done = createTransactionWaiter(tx);
      tx.objectStore("flightRecords").add(record);
      await done;
      var message = "飛行記録の一時保存を保存しました。";
    } else {
      const tx = db.transaction(["flightRecords"], "readwrite");
      let failureReason = "";
      done = createTransactionWaiter(tx, () => failureReason);
      const store = tx.objectStore("flightRecords");
      const current = await requestResult(store.get(id));
      if (!current) {
        failureReason = "編集対象の飛行記録が見つかりません。";
        tx.abort();
        try { await done; } catch (_) {}
        throw new Error(failureReason);
      }
      if (current.status !== "下書き" && current.status !== "飛行中") {
        failureReason = "この状態の飛行記録は編集できません。";
        tx.abort();
        try { await done; } catch (_) {}
        throw new Error(failureReason);
      }
      if (editStartedUpdatedAt && current.updatedAt !== editStartedUpdatedAt) {
        failureReason = "他の画面で更新されました。再読み込みしてください。";
        tx.abort();
        try { await done; } catch (_) {}
        throw new Error(failureReason);
      }
      if (current.status === "飛行中" && (!fields.aircraftId || !fields.pilotId || !fields.takeoffAt)) {
        failureReason = "飛行中の記録は、機体・操縦者・離陸日時を空欄にできません。";
        tx.abort();
        try { await done; } catch (_) {}
        throw new Error(failureReason);
      }
      const updated = {
        ...current,
        ...fields,
        flightMinutes: flightTimeFields.flightMinutes,
        manuallyAdjusted: flightTimeFields.manuallyAdjusted,
        revision: current.revision,
        updatedAt: now
      };
      store.put(updated);
      await done;
      var message = current.status === "飛行中" ? "飛行中の記録を保存しました。" : "飛行記録の一時保存を更新しました。";
    }
    await renderFlights();
    closeEditor();
    $("dbStatus").textContent = message;
  } catch (error) {
    if (done) { try { await done; } catch (_) {} }
    showMessage(error.message || "保存に失敗しました。");
  } finally {
    flightActionInProgress = false;
    updateActionButtons();
  }
}

async function recordTakeoff() {
  if (flightActionInProgress) return;
  flightActionInProgress = true;
  updateActionButtons();
  try {
    if (currentEditStatus === "飛行中") return;
    if (!$("aircraftId").value || !$("pilotId").value) {
      showMessage("機体と操縦者を選択してください。"); return;
    }
    if ($("takeoffAt").value && !window.confirm("入力されている離陸日時を現在時刻で上書きしますか？")) return;
    const fields = collectFormFields();
    const flightTimeFields = collectFlightTimeFields();
    const nowDate = new Date();
    nowDate.setSeconds(0, 0);
    const now = nowDate.toISOString();
    fields.takeoffAt = now;
    const id = $("flightId").value;
    const tx = db.transaction(["flightRecords", "aircraft", "pilots"], "readwrite");
    let failureReason = "";
    const done = createTransactionWaiter(tx, () => failureReason);
    const store = tx.objectStore("flightRecords");
    const [aircraft, pilot] = await Promise.all([
      requestResult(tx.objectStore("aircraft").get(fields.aircraftId)),
      requestResult(tx.objectStore("pilots").get(fields.pilotId))
    ]);
    if (!aircraft || aircraft.status !== "使用中" || !pilot || pilot.status !== "使用中") {
      failureReason = "使用停止の機体・操縦者では離陸を記録できません。使用中のものを選択してください。";
      tx.abort();
      try { await done; } catch (_) {}
      showMessage(failureReason);
      return;
    }
    if (!id) {
      const record = {
        ...newRecord(fields, "飛行中", now),
        ...flightTimeFields
      };
      store.add(record);
    } else {
      const current = await requestResult(store.get(id));
      if (!current) { failureReason = "対象の飛行記録が見つかりません。"; tx.abort(); await done; return; }
      if (current.status !== "下書き") { failureReason = "一時保存以外から離陸を記録できません。"; tx.abort(); await done; return; }
      store.put({ ...current, ...fields, ...flightTimeFields, status: "飛行中", updatedAt: now });
    }
    await done;
    await renderFlights();
    closeEditor();
    $("dbStatus").textContent = "離陸を記録しました。状態は『飛行中』です。";
  } catch (error) { showMessage(error.message || "離陸の記録に失敗しました。"); }
  finally { flightActionInProgress = false; updateActionButtons(); }
}

async function recordLanding() {
  if (flightActionInProgress) return;
  flightActionInProgress = true;
  updateActionButtons();
  try {
    if (!$("flightId").value || currentEditStatus !== "飛行中") return;
    const fields = collectFormFields();
    if (!fields.aircraftId || !fields.pilotId || !fields.takeoffAt) {
      showMessage("着陸を記録するには、機体・操縦者・離陸日時が必要です。");
      return;
    }
    if ($("landingAt").value && !window.confirm("入力されている着陸日時を現在時刻で上書きしますか？")) return;
    const nowDate = new Date();
    nowDate.setSeconds(0, 0);
    const now = nowDate.toISOString();
    fields.landingAt = now;
    const tx = db.transaction(["flightRecords"], "readwrite");
    let failureReason = "";
    const done = createTransactionWaiter(tx, () => failureReason);
    const store = tx.objectStore("flightRecords");
    const current = await requestResult(store.get($("flightId").value));
    if (!current) { failureReason = "対象の飛行記録が見つかりません。"; tx.abort(); await done; return; }
    if (current.status !== "飛行中") { failureReason = "飛行中の記録ではありません。"; tx.abort(); await done; return; }
    store.put({ ...current, ...fields, status: "飛行中", updatedAt: now });
    await done;
    await renderFlights();
    closeEditor();
    $("dbStatus").textContent = "着陸を記録しました。状態は『飛行中』です。";
  } catch (error) { showMessage(error.message || "着陸の記録に失敗しました。"); }
  finally { flightActionInProgress = false; updateActionButtons(); }
}

async function returnToDraft(record) {
  if (!window.confirm("この飛行中の記録を一時保存に戻しますか？\n入力内容と離陸・着陸日時は保持されます。")) return;
  try {
    const tx = db.transaction(["flightRecords"], "readwrite");
    let failureReason = "";
    const done = createTransactionWaiter(tx, () => failureReason);
    const store = tx.objectStore("flightRecords");
    const current = await requestResult(store.get(record.id));
    if (!current) { failureReason = "対象の飛行記録が見つかりません。"; tx.abort(); await done; return; }
    if (current.status !== "飛行中") { failureReason = "対象の記録は飛行中ではありません。"; tx.abort(); await done; return; }
    store.put({ ...current, status: "下書き", updatedAt: new Date().toISOString() });
    await done;
    await renderFlights();
    $("dbStatus").textContent = "飛行中の記録を一時保存に戻しました。";
  } catch (error) { $("dbStatus").textContent = error.message || "一時保存に戻せませんでした。"; }
}

async function renderFlights() {
  const tx = db.transaction(["flightRecords"], "readonly");
  const records = await requestResult(tx.objectStore("flightRecords").getAll());
  await transactionDone(tx);
  records.sort((a, b) => (b.updatedAt || "").localeCompare(a.updatedAt || ""));
  const list = $("flightList");
  list.replaceChildren();
  $("emptyMessage").hidden = records.length !== 0;
  for (const record of records) {
    const card = document.createElement("article");
    card.className = "aircraft-card";
    const info = document.createElement("div");
    const title = document.createElement("h3");
    const status = document.createElement("span");
    status.className = "badge" + (record.status === "下書き" ? "" : " stopped");
    status.textContent = displayStatus(record.status);
    title.textContent = "飛行記録";
    title.append(" ", status);
    const meta = document.createElement("div");
    meta.className = "card-meta";
    meta.textContent = `離陸日時：${formatJapanDateTime(record.takeoffAt)}｜更新日時：${formatJapanDateTime(record.updatedAt)}`;
    info.append(title, meta);
    const actions = document.createElement("div");
    actions.className = "card-actions";
    if (record.status === "下書き" || record.status === "飛行中") {
      const editButton = document.createElement("button");
      editButton.className = "subtle";
      editButton.textContent = record.status === "飛行中" ? "続ける" : "編集";
      editButton.addEventListener("click", () => beginEdit(record));
      actions.append(editButton);
      if (record.status === "下書き") {
        const deleteButton = document.createElement("button");
        deleteButton.className = "subtle";
        deleteButton.textContent = "削除";
        deleteButton.addEventListener("click", () => deleteFlight(record));
        actions.append(deleteButton);
      } else {
        const backButton = document.createElement("button");
        backButton.className = "subtle";
        backButton.textContent = "一時保存";
        backButton.addEventListener("click", () => returnToDraft(record));
        actions.append(backButton);
      }
    }
    card.append(info, actions);
    list.append(card);
  }
}

async function beginEdit(record) {
  try {
    let targetRecord = record;
    if (record.status === "飛行中") {
      const tx = db.transaction(["flightRecords"], "readonly");
      targetRecord = await requestResult(tx.objectStore("flightRecords").get(record.id));
      await transactionDone(tx);
      if (!targetRecord || targetRecord.status !== "飛行中") {
        await renderFlights();
        $("dbStatus").textContent = "記録が他の画面で更新されています。一覧を最新の状態にしました。";
        return;
      }
    }

    if (targetRecord.status !== "下書き" && targetRecord.status !== "飛行中") return;
    currentEditStatus = targetRecord.status;
    editStartedUpdatedAt = targetRecord.updatedAt || "";
    $("flightId").value = targetRecord.id;
    await loadAircraftAndPilots(targetRecord.aircraftId || "", targetRecord.pilotId || "");
    $("purpose").value = targetRecord.purpose ?? "";
    $("route").value = targetRecord.route ?? "";
    $("waypoints").value = targetRecord.waypoints ?? "";
    if (targetRecord.prohibitedAirspace === "該当なし") {
      $("prohibitedAirspaceNone").checked = true; $("prohibitedAirspace").value = "";
    } else {
      $("prohibitedAirspaceNone").checked = false; $("prohibitedAirspace").value = targetRecord.prohibitedAirspace ?? "";
    }
    if (targetRecord.flightMethod === "該当なし") {
      $("flightMethodNone").checked = true; $("flightMethod").value = "";
    } else {
      $("flightMethodNone").checked = false; $("flightMethod").value = targetRecord.flightMethod ?? "";
    }
    updateProhibitedAirspaceField(); updateFlightMethodField();
    $("takeoffLocation").value = targetRecord.takeoffLocation ?? "";
    $("takeoffAt").value = utcToJapanDateTime(targetRecord.takeoffAt);
    $("landingLocation").value = targetRecord.landingLocation ?? "";
    $("landingAt").value = utcToJapanDateTime(targetRecord.landingAt);
    $("flightMinutesInput").value = targetRecord.flightMinutes === null || targetRecord.flightMinutes === undefined ? "" : String(targetRecord.flightMinutes);
    $("safetyIssue").value = targetRecord.safetyIssue ?? "";
    $("safetyDetails").value = targetRecord.safetyDetails ?? "";
    $("aircraftCondition").value = targetRecord.aircraftCondition ?? "";
    updateSafetyFields();
    $("specialNotes").value = targetRecord.specialNotes ?? "";
    showEditor(true);
  } catch (error) {
    closeEditor();
    $("dbStatus").textContent = error.message || "飛行記録を開けませんでした。";
  }
}

async function deleteFlight(record) {
  if (record.status !== "下書き") return;
  if (!window.confirm("この飛行記録の一時保存を削除します。\nこの操作は元に戻せません。よろしいですか？")) return;
  try {
    const tx = db.transaction(["flightRecords"], "readwrite");
    let failureReason = "";
    const done = createTransactionWaiter(tx, () => failureReason);
    const store = tx.objectStore("flightRecords");
    const current = await requestResult(store.get(record.id));
    if (!current) { failureReason = "対象の飛行記録が見つかりません。"; tx.abort(); await done; return; }
    if (current.status !== "下書き") { failureReason = "一時保存以外の飛行記録は削除できません。"; tx.abort(); await done; return; }
    store.delete(record.id);
    await done;
    await renderFlights();
    $("dbStatus").textContent = "飛行記録の一時保存を削除しました。";
  } catch (error) {
    $("dbStatus").textContent = error.message || "削除に失敗しました。";
  }
}

async function initialize() {
  try {
    db = await openStep2Database();
    $("dbStatus").textContent = `STEP2データベース準備完了｜${db.name}｜DBバージョン ${db.version}`;
    await loadAircraftAndPilots();
    await renderFlights();
  } catch (error) {
    $("dbStatus").textContent = `準備エラー：${error.message}`;
    $("newFlightButton").disabled = true;
  }
}

$("newFlightButton").addEventListener("click", async () => {
  $("flightForm").reset();
  $("flightId").value = "";
  currentEditStatus = "下書き";
  editStartedUpdatedAt = "";
  $("safetyDetailsFields").hidden = true;
  $("prohibitedAirspace").disabled = false;
  $("flightMethod").disabled = false;
  await loadAircraftAndPilots();
  showEditor(false);
});
$("closeEditorButton").addEventListener("click", closeEditor);
$("cancelEditButton").addEventListener("click", closeEditor);
$("flightForm").addEventListener("submit", saveFlight);
$("safetyIssue").addEventListener("change", updateSafetyFields);
$("prohibitedAirspaceNone").addEventListener("change", updateProhibitedAirspaceField);
$("flightMethodNone").addEventListener("change", updateFlightMethodField);
$("aircraftId").addEventListener("change", updateActionButtons);
$("pilotId").addEventListener("change", updateActionButtons);
$("takeoffButton").addEventListener("click", recordTakeoff);
$("landingButton").addEventListener("click", recordLanding);
initialize();

if ("serviceWorker" in navigator && location.protocol.startsWith("http")) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js").catch(error => {
      console.warn("確認用ServiceWorkerの登録に失敗しました。", error);
    });
  });
}
