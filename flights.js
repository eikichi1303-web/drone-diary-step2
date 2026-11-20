import {
  openStep2Database,
  requestResult,
  transactionDone
} from "./db.js";

const $ = id => document.getElementById(id);

let db;

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
    ? "飛行記録の下書きを編集"
    : "飛行記録の下書き";

  $("formMessage").textContent = "";

  $("editorPanel").scrollIntoView({
    behavior: "smooth",
    block: "start"
  });
}

function closeEditor() {
  $("flightForm").reset();
  $("flightId").value = "";

  $("safetyDetailsFields").hidden = true;

  $("prohibitedAirspace").disabled = false;
  $("flightMethod").disabled = false;

  $("editorPanel").hidden = true;
  $("formMessage").textContent = "";
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

  if (checked) {
    $("prohibitedAirspace").value = "";
  }
}

function updateFlightMethodField() {
  const checked = $("flightMethodNone").checked;

  $("flightMethod").disabled = checked;

  if (checked) {
    $("flightMethod").value = "";
  }
}

// datetime-localの値を、日本時間として扱ってUTC ISO文字列に変換する。
function japanDateTimeToUTC(value) {
  if (!value) return "";

  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) {
    throw new Error("日時の入力形式が正しくありません。");
  }

  const date = new Date(value + ":00+09:00");

  if (Number.isNaN(date.getTime())) {
    throw new Error("日時を正しく読み取れません。");
  }

  return date.toISOString();
}

// UTC ISO文字列を日本時間のdatetime-local形式にする。
function utcToJapanDateTime(value) {
  if (!value) return "";

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) return "";

  const parts = new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
  }).formatToParts(date);

  const part = type => parts.find(item => item.type === type)?.value || "";

  return `${part("year")}-${part("month")}-${part("day")}T${part("hour")}:${part("minute")}`;
}

function formatJapanDateTime(value) {
  if (!value) return "未入力";

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) return "日時不明";

  return new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
  }).format(date);
}

async function loadAircraftAndPilots(selectedAircraftId = "", selectedPilotId = "") {
  const tx = db.transaction(["aircraft", "pilots"], "readonly");

  const aircraftRequest = requestResult(
    tx.objectStore("aircraft").getAll()
  );

  const pilotRequest = requestResult(
    tx.objectStore("pilots").getAll()
  );

  const [aircraftRecords, pilotRecords] = await Promise.all([
    aircraftRequest,
    pilotRequest
  ]);

  await transactionDone(tx);

  const aircraftSelect = $("aircraftId");
  const pilotSelect = $("pilotId");

  aircraftSelect.replaceChildren();
  pilotSelect.replaceChildren();

  aircraftSelect.add(new Option("選択してください", ""));
  pilotSelect.add(new Option("選択してください", ""));

  const availableAircraft = aircraftRecords.filter(
    record => record.status === "使用中"
  );

  const availablePilots = pilotRecords.filter(
    record => record.status === "使用中"
  );

  for (const record of availableAircraft) {
    const option = new Option(
      `${record.name}（${record.registrationMark || "登録記号なし"}）`,
      record.id
    );

    aircraftSelect.add(option);
  }

  for (const record of availablePilots) {
    const option = new Option(record.name, record.id);
    pilotSelect.add(option);
  }

  // 編集時に選択済みデータが使用停止になっていても、
  // 現在の記録を維持できるよう選択肢に残す。
  if (selectedAircraftId &&
      !availableAircraft.some(record => record.id === selectedAircraftId)) {

    const stoppedAircraft = aircraftRecords.find(
      record => record.id === selectedAircraftId
    );

    if (stoppedAircraft) {
      aircraftSelect.add(
        new Option(
          `${stoppedAircraft.name}（使用停止）`,
          stoppedAircraft.id
        )
      );
    }
  }

  if (selectedPilotId &&
      !availablePilots.some(record => record.id === selectedPilotId)) {

    const stoppedPilot = pilotRecords.find(
      record => record.id === selectedPilotId
    );

    if (stoppedPilot) {
      pilotSelect.add(
        new Option(
          `${stoppedPilot.name}（使用停止）`,
          stoppedPilot.id
        )
      );
    }
  }

  aircraftSelect.value = selectedAircraftId;
  pilotSelect.value = selectedPilotId;
}

function collectFormData() {
  let prohibitedAirspace = $("prohibitedAirspace").value.trim();

  if ($("prohibitedAirspaceNone").checked) {
    prohibitedAirspace = "該当なし";
  }

  let flightMethod = $("flightMethod").value.trim();

  if ($("flightMethodNone").checked) {
    flightMethod = "該当なし";
  }

  const safetyIssue = $("safetyIssue").value;

  return {
    aircraftId: $("aircraftId").value,
    pilotId: $("pilotId").value,

    aircraftSnapshot: null,
    pilotSnapshot: null,

    purpose: $("purpose").value.trim(),
    route: $("route").value.trim(),
    waypoints: $("waypoints").value.trim(),

    prohibitedAirspace,
    flightMethod,

    takeoffLocation: $("takeoffLocation").value.trim(),
    takeoffAt: japanDateTimeToUTC($("takeoffAt").value),

    landingLocation: $("landingLocation").value.trim(),
    landingAt: japanDateTimeToUTC($("landingAt").value),

    flightMinutes: null,

    safetyIssue,
    safetyDetails: safetyIssue === "あり"
      ? $("safetyDetails").value.trim()
      : "",

    aircraftCondition: safetyIssue === "あり"
      ? $("aircraftCondition").value.trim()
      : "",

    specialNotes: $("specialNotes").value.trim(),

    status: "下書き",
    manuallyAdjusted: false,

    completedAt: "",
    cancelledAt: "",
    cancelReason: ""
  };
}

async function saveFlight(event) {
  event.preventDefault();

  try {
    const formData = collectFormData();
    const id = $("flightId").value;
    const now = new Date().toISOString();

    if (!id) {
      const record = {
        id: uuidV4(),
        ...formData,
        revision: 1,
        createdAt: now,
        updatedAt: now
      };

      const tx = db.transaction(["flightRecords"], "readwrite");

      tx.objectStore("flightRecords").add(record);

      await transactionDone(tx);

      var saveMessage = "飛行記録の下書きを保存しました。";

    } else {
      const readTx = db.transaction(["flightRecords"], "readonly");

      const current = await requestResult(
        readTx.objectStore("flightRecords").get(id)
      );

      await transactionDone(readTx);

      if (!current) {
        throw new Error("編集対象の飛行記録が見つかりません。");
      }

      if (current.status !== "下書き") {
        throw new Error("下書き以外の飛行記録は編集できません。");
      }

      const updated = {
        ...current,
        ...formData,

        // 下書き編集ではrevisionを増やさない。
        revision: current.revision,
        createdAt: current.createdAt,
        updatedAt: now,

        // 下書きではスナップショットを固定しない。
        aircraftSnapshot: null,
        pilotSnapshot: null
      };

      const tx = db.transaction(["flightRecords"], "readwrite");

      tx.objectStore("flightRecords").put(updated);

      await transactionDone(tx);

      var saveMessage = "飛行記録の下書きを更新しました。";
    }

    await renderFlights();

    closeEditor();

    $("dbStatus").textContent = saveMessage;

  } catch (error) {
    showMessage(error.message || "保存に失敗しました。");
  }
}

async function renderFlights() {
  const tx = db.transaction(["flightRecords"], "readonly");

  const records = await requestResult(
    tx.objectStore("flightRecords").getAll()
  );

  await transactionDone(tx);

  // 更新日時の新しい順。
  records.sort((a, b) =>
    (b.updatedAt || "").localeCompare(a.updatedAt || "")
  );

  const list = $("flightList");

  list.replaceChildren();

  $("emptyMessage").hidden = records.length !== 0;

  for (const record of records) {
    const card = document.createElement("article");
    card.className = "aircraft-card";

    const info = document.createElement("div");

    const title = document.createElement("h3");

    const status = document.createElement("span");

    status.className = "badge" +
      (record.status === "下書き" ? "" : " stopped");

    status.textContent = record.status;

    title.textContent = "飛行記録";

    title.append(" ", status);

    const meta = document.createElement("div");
    meta.className = "card-meta";

    meta.textContent =
      `離陸日時：${formatJapanDateTime(record.takeoffAt)}｜` +
      `更新日時：${formatJapanDateTime(record.updatedAt)}`;

    info.append(title, meta);

    const actions = document.createElement("div");
    actions.className = "card-actions";

    if (record.status === "下書き") {
      const editButton = document.createElement("button");

      editButton.className = "subtle";
      editButton.textContent = "編集";

      editButton.addEventListener("click", () => {
        beginEdit(record);
      });

      const deleteButton = document.createElement("button");

      deleteButton.className = "subtle";
      deleteButton.textContent = "削除";

      deleteButton.addEventListener("click", () => {
        deleteFlight(record);
      });

      actions.append(editButton, deleteButton);
    }

    card.append(info, actions);

    list.append(card);
  }
}

async function beginEdit(record) {
  if (record.status !== "下書き") {
    return;
  }

  $("flightId").value = record.id;

  await loadAircraftAndPilots(
    record.aircraftId || "",
    record.pilotId || ""
  );

  $("purpose").value = record.purpose ?? "";
  $("route").value = record.route ?? "";
  $("waypoints").value = record.waypoints ?? "";

  if (record.prohibitedAirspace === "該当なし") {
    $("prohibitedAirspaceNone").checked = true;
    $("prohibitedAirspace").value = "";
  } else {
    $("prohibitedAirspaceNone").checked = false;
    $("prohibitedAirspace").value = record.prohibitedAirspace ?? "";
  }

  if (record.flightMethod === "該当なし") {
    $("flightMethodNone").checked = true;
    $("flightMethod").value = "";
  } else {
    $("flightMethodNone").checked = false;
    $("flightMethod").value = record.flightMethod ?? "";
  }

  updateProhibitedAirspaceField();
  updateFlightMethodField();

  $("takeoffLocation").value = record.takeoffLocation ?? "";
  $("takeoffAt").value = utcToJapanDateTime(record.takeoffAt);

  $("landingLocation").value = record.landingLocation ?? "";
  $("landingAt").value = utcToJapanDateTime(record.landingAt);

  $("safetyIssue").value = record.safetyIssue ?? "";

  $("safetyDetails").value = record.safetyDetails ?? "";
  $("aircraftCondition").value = record.aircraftCondition ?? "";

  updateSafetyFields();

  $("specialNotes").value = record.specialNotes ?? "";

  showEditor(true);
}

async function deleteFlight(record) {
  if (record.status !== "下書き") {
    return;
  }

  const confirmed = window.confirm(
    "この飛行記録の下書きを削除します。\n" +
    "この操作は元に戻せません。よろしいですか？"
  );

  if (!confirmed) return;

  try {
    const tx = db.transaction(["flightRecords"], "readwrite");

    tx.objectStore("flightRecords").delete(record.id);

    await transactionDone(tx);

    await renderFlights();

    $("dbStatus").textContent = "飛行記録の下書きを削除しました。";

  } catch (error) {
    $("dbStatus").textContent =
      error.message || "削除に失敗しました。";
  }
}

async function initialize() {
  try {
    db = await openStep2Database();

    $("dbStatus").textContent =
      `STEP2データベース準備完了｜${db.name}｜DBバージョン ${db.version}`;

    await loadAircraftAndPilots();

    await renderFlights();

  } catch (error) {
    $("dbStatus").textContent =
      `準備エラー：${error.message}`;

    $("newFlightButton").disabled = true;
  }
}

$("newFlightButton").addEventListener("click", async () => {
  $("flightForm").reset();

  $("flightId").value = "";

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

$("prohibitedAirspaceNone").addEventListener(
  "change",
  updateProhibitedAirspaceField
);

$("flightMethodNone").addEventListener(
  "change",
  updateFlightMethodField
);

initialize();

if ("serviceWorker" in navigator && location.protocol.startsWith("http")) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js").catch(error => {
      console.warn(
        "確認用Service Workerの登録に失敗しました。",
        error
      );
    });
  });
}
