import { openStep2Database, requestResult, transactionDone } from "./db.js";

const $ = id => document.getElementById(id);
let db;

const PILOT_SNAPSHOT_FIELDS = [
  "name",
  "hasLicense",
  "licenseType",
  "licenseNumber"
];

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
  $("editorTitle").textContent = editing ? "操縦者を編集" : "操縦者を登録";
  $("editReasonFields").hidden = !editing;
  $("formMessage").textContent = "";
  $("editorPanel").scrollIntoView({ behavior: "smooth", block: "start" });
}

function closeEditor() {
  $("pilotForm").reset();
  $("pilotId").value = "";
  $("editReasonFields").hidden = true;
  $("editReason").value = "";
  $("licenseNumberFields").hidden = true;
  $("licenseNumber").required = false;
  $("editorPanel").hidden = true;
  $("formMessage").textContent = "";
}

function updateLicenseFields() {
  const hasLicense = $("hasLicense").value === "true";
  $("licenseNumberFields").hidden = !hasLicense;
  $("licenseNumber").required = hasLicense;
  if (!hasLicense) $("licenseNumber").value = "";
}

function collectFormData() {
  const licenseValue = $("hasLicense").value;
  if (licenseValue !== "true" && licenseValue !== "false") {
    throw new Error("技能証明の有無を選択してください。");
  }

  const hasLicense = licenseValue === "true";
  const data = {
    name: $("name").value.trim(),
    hasLicense,
    licenseType: $("licenseType").value.trim(),
    licenseNumber: hasLicense ? $("licenseNumber").value.trim() : "",
    status: $("status").value,
    notes: $("notes").value.trim()
  };

  if (!data.name) throw new Error("氏名を入力してください。");
  if (hasLicense && !data.licenseNumber) {
    throw new Error("技能証明が「あり」の場合、技能証明番号を入力してください。");
  }
  if (!["使用中", "使用停止"].includes(data.status)) {
    throw new Error("使用状態が正しくありません。");
  }
  return data;
}

function comparablePilot(record) {
  const fields = ["name", "hasLicense", "licenseType", "licenseNumber", "status", "notes"];
  return Object.fromEntries(fields.map(field => [
    field,
    record[field] ?? (field === "hasLicense" ? false : "")
  ]));
}

function sameData(a, b) {
  return JSON.stringify(comparablePilot(a)) === JSON.stringify(comparablePilot(b));
}

function createPilotSnapshot(record) {
  return Object.fromEntries(
    PILOT_SNAPSHOT_FIELDS.map(field => [
      field,
      record[field] ?? (field === "hasLicense" ? false : "")
    ])
  );
}

function samePilotSnapshot(a, b) {
  if (!a || typeof a !== "object") return false;

  return PILOT_SNAPSHOT_FIELDS.every(field => {
    const fallback = field === "hasLicense" ? false : "";
    return (a[field] ?? fallback) === (b[field] ?? fallback);
  });
}

async function savePilot(event) {
  event.preventDefault();
  try {
    const formData = collectFormData();
    const id = $("pilotId").value;
    const now = new Date().toISOString();

    if (!id) {
      const record = {
        id: uuidV4(),
        ...formData,
        revision: 1,
        createdAt: now,
        updatedAt: now
      };
      const tx = db.transaction(["pilots"], "readwrite");
      tx.objectStore("pilots").add(record);
      await transactionDone(tx);
      var saveResultMessage = "操縦者を登録しました。";
    } else {
      const readTx = db.transaction(["pilots"], "readonly");
      const current = await requestResult(readTx.objectStore("pilots").get(id));
      await transactionDone(readTx);
      if (!current) throw new Error("編集対象の操縦者が見つかりません。");

      const proposed = { ...current, ...formData };
      if (sameData(current, proposed)) {
        showMessage("変更箇所がありません。保存・履歴追加・更新日時の変更は行いません。", false);
        return;
      }

      const history = {
        id: uuidV4(),
        recordType: "pilot",
        recordId: id,
        previousRevision: current.revision,
        beforeData: structuredClone(current),
        editedAt: now,
        editReason: $("editReason").value.trim() || ""
      };
      const updated = {
        ...current,
        ...formData,
        revision: current.revision + 1,
        updatedAt: now
      };

      // 操縦者本体・編集履歴・完了記録のスナップショット更新を同一トランザクションで行う。
      const tx = db.transaction(
        ["pilots", "editHistories", "flightRecords"],
        "readwrite"
      );
      const done = transactionDone(tx);

      const pilotStore = tx.objectStore("pilots");
      const historyStore = tx.objectStore("editHistories");
      const flightStore = tx.objectStore("flightRecords");

      historyStore.add(history);
      pilotStore.put(updated);

      const newSnapshot = createPilotSnapshot(updated);
      const cursorRequest = flightStore.index("pilotId").openCursor(
        IDBKeyRange.only(id)
      );

      cursorRequest.onsuccess = () => {
        const cursor = cursorRequest.result;
        if (!cursor) return;

        const flightRecord = cursor.value;

        if (
          flightRecord.status === "完了" &&
          !samePilotSnapshot(flightRecord.pilotSnapshot, newSnapshot)
        ) {
          historyStore.add({
            id: uuidV4(),
            recordType: "flightRecord",
            recordId: flightRecord.id,
            previousRevision: flightRecord.revision,
            beforeData: structuredClone(flightRecord.pilotSnapshot),
            editedAt: now,
            editReason: "操縦者変更によるスナップショット再取得"
          });

          cursor.update({
            ...flightRecord,
            pilotSnapshot: newSnapshot,
            revision: flightRecord.revision + 1,
            updatedAt: now
          });
        }

        cursor.continue();
      };

      await done;
      var saveResultMessage = "操縦者情報を更新し、編集履歴を保存しました。";
    }

    await renderPilots();
    closeEditor();
    $("dbStatus").textContent = saveResultMessage;
  } catch (error) {
    showMessage(error.message || "保存に失敗しました。");
  }
}

async function renderPilots() {
  const tx = db.transaction(["pilots"], "readonly");
  const records = await requestResult(tx.objectStore("pilots").getAll());
  await transactionDone(tx);

  records.sort((a, b) => (a.name || "").localeCompare(b.name || "", "ja"));
  const list = $("pilotList");
  list.replaceChildren();
  $("emptyMessage").hidden = records.length !== 0;

  for (const record of records) {
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
    const licenseText = record.hasLicense ? `技能証明あり｜番号：${record.licenseNumber || ""}` : "技能証明なし";
    const typeText = record.licenseType ? `｜種類：${record.licenseType}` : "";
    meta.textContent = `${licenseText}${typeText}`;
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
    deleteButton.addEventListener("click", () => deletePilot(record));

    actions.append(editButton, deleteButton);
    card.append(info, actions);
    list.append(card);
  }
}

function beginEdit(record) {
  $("pilotId").value = record.id;
  $("name").value = record.name ?? "";
  $("hasLicense").value = String(Boolean(record.hasLicense));
  $("licenseType").value = record.licenseType ?? "";
  $("licenseNumber").value = record.licenseNumber ?? "";
  $("status").value = record.status ?? "使用中";
  $("notes").value = record.notes ?? "";
  $("editReason").value = "";
  updateLicenseFields();
  showEditor(true);
}

async function deletePilot(record) {
  const confirmed = window.confirm(
    `「${record.name}」を削除します。\n飛行記録がない場合に限り削除できます。\n関連する編集履歴も同時に削除します。\nこの操作は元に戻せません。よろしいですか？`
  );
  if (!confirmed) return;

  try {
    // 工程5で追加された飛行記録の保存領域を確認する。
    if (!db.objectStoreNames.contains("flightRecords")) {
      throw new Error("飛行記録の保存領域が見つかりません。安全のため操縦者の削除を停止しました。");
    }

    // 飛行記録の確認と操縦者・編集履歴の削除を同一トランザクションで行う。
    const tx = db.transaction(
      ["pilots", "editHistories", "flightRecords"],
      "readwrite"
    );
    const done = transactionDone(tx);

    const pilotStore = tx.objectStore("pilots");
    const histories = tx.objectStore("editHistories");
    const flightRecords = tx.objectStore("flightRecords");

    const currentRequest = pilotStore.get(record.id);
    const flightCountRequest = flightRecords.index("pilotId").count(
      IDBKeyRange.only(record.id)
    );

    const [current, flightCount] = await Promise.all([
      requestResult(currentRequest),
      requestResult(flightCountRequest)
    ]);

    if (!current) {
      await done;
      throw new Error("削除対象の操縦者が見つかりません。");
    }

    if (flightCount > 0) {
      await done;
      throw new Error("この操縦者に紐づく飛行記録が存在するため、削除できません。");
    }

    pilotStore.delete(record.id);

    const cursorRequest = histories.index("recordId").openCursor(
      IDBKeyRange.only(record.id)
    );
    cursorRequest.onsuccess = () => {
      const cursor = cursorRequest.result;
      if (cursor) {
        // recordTypeも確認し、同じIDを持つ別種別の履歴は消さない。
        if (cursor.value.recordType === "pilot") cursor.delete();
        cursor.continue();
      }
    };

    await done;
    await renderPilots();
    $("dbStatus").textContent = "操縦者と関連する編集履歴を削除しました。";
  } catch (error) {
    $("dbStatus").textContent = error.message || "削除に失敗しました。";
  }
}

async function initialize() {
  try {
    db = await openStep2Database();
    $("dbStatus").textContent = `STEP2データベース準備完了｜${db.name}｜DBバージョン ${db.version}`;
    await renderPilots();
  } catch (error) {
    $("dbStatus").textContent = `準備エラー：${error.message}`;
    $("newPilotButton").disabled = true;
  }
}

$("newPilotButton").addEventListener("click", () => {
  $("pilotForm").reset();
  $("pilotId").value = "";
  $("editReason").value = "";
  $("editReasonFields").hidden = true;
  $("status").value = "使用中";
  $("hasLicense").value = "";
  updateLicenseFields();
  showEditor(false);
});
$("closeEditorButton").addEventListener("click", closeEditor);
$("cancelEditButton").addEventListener("click", closeEditor);
$("hasLicense").addEventListener("change", updateLicenseFields);
$("pilotForm").addEventListener("submit", savePilot);

initialize();

if ("serviceWorker" in navigator && location.protocol.startsWith("http")) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js").catch(error => {
      console.warn("確認用Service Workerの登録に失敗しました。", error);
    });
  });
}

