const { app, BrowserWindow, ipcMain } = require("electron");
const path = require("path");
const crypto = require("crypto");
const Store = require("electron-store");

const store = new Store({
  name: "techbay-pos-store",
  defaults: {
    auth: {
      authorized: false,
      clientId: "",
      clientName: "",
      accessKey: ""
    },
    settings: {
      companyName: "Techbay Store",
      companyAddress: "Chemnad, Kasaragod, Kerala",
      currency: "INR",
      upiId: ""
    },
    products: [],
    tables: [
      { sync_id: "tbl-1", table_name: "Table 1", status: "EMPTY", active_kot_sync_id: "" },
      { sync_id: "tbl-2", table_name: "Table 2", status: "EMPTY", active_kot_sync_id: "" },
      { sync_id: "tbl-3", table_name: "Table 3", status: "EMPTY", active_kot_sync_id: "" },
      { sync_id: "tbl-4", table_name: "Table 4", status: "EMPTY", active_kot_sync_id: "" },
      { sync_id: "tbl-5", table_name: "Table 5", status: "EMPTY", active_kot_sync_id: "" },
      { sync_id: "tbl-6", table_name: "Table 6", status: "EMPTY", active_kot_sync_id: "" }
    ],
    kots: [],
    bills: [],
    expenses: [],
    customers: [],
    purchases: [],
    syncQueue: []
  }
});

const SUPABASE_REST_BASE = "https://ibqdujwkwgqptajgpjll.supabase.co/rest/v1";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImlicWR1andrd2dxcHRhamdwamxsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTU2Nzk3ODMsImV4cCI6MjExMTI1NTc4M30.KmPNvy8aEnL3GyYS03lS0dW7slnRMaddIN0B0N_qw30";

let mainWindow = null;

function nowIsoUtc() {
  return new Date().toISOString();
}

function nowLocalStamp() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function getAuthHeaders(includePrefer = false) {
  const headers = {
    apikey: SUPABASE_ANON_KEY,
    Authorization: `Bearer ${SUPABASE_ANON_KEY}`
  };
  if (includePrefer) {
    headers["Content-Type"] = "application/json";
    headers["Prefer"] = "resolution=merge-duplicates,return=representation";
  }
  return headers;
}

async function authorizeClient(clientId, accessKey) {
  const cleanId = (clientId || "").trim();
  const cleanKey = (accessKey || "").trim();
  if (!cleanId || !cleanKey) {
    return { ok: false, message: "Enter both Client ID and Access Key" };
  }

  try {
    const url = `${SUPABASE_REST_BASE}/client_workspaces?client_id=eq.${encodeURIComponent(cleanId)}&access_key=eq.${encodeURIComponent(cleanKey)}&is_active=eq.true&select=client_id,client_name,expires_at`;
    const res = await fetch(url, { method: "GET", headers: getAuthHeaders(false) });
    if (!res.ok) {
      return { ok: false, message: `Auth check failed (HTTP ${res.status})` };
    }
    const rows = await res.json();
    if (!Array.isArray(rows) || rows.length === 0) {
      return { ok: false, message: "Invalid Client ID or Access Key" };
    }
    const clientName = rows[0].client_name || cleanId;
    store.set("auth", {
      authorized: true,
      clientId: cleanId,
      clientName,
      accessKey: cleanKey
    });
    return { ok: true, clientId: cleanId, clientName, message: `Authorized for ${clientName}` };
  } catch (err) {
    return { ok: false, message: err.message || "Network verification error" };
  }
}

async function sendUpsertHttp(table, payload, onConflict = "sync_id") {
  const endpoint = onConflict
    ? `${SUPABASE_REST_BASE}/${table}?on_conflict=${encodeURIComponent(onConflict)}`
    : `${SUPABASE_REST_BASE}/${table}`;

  try {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: getAuthHeaders(true),
      body: JSON.stringify(payload)
    });
    const body = await res.text();
    return { success: res.ok, code: res.status, body };
  } catch (err) {
    return { success: false, code: -1, body: err.message || "Network error" };
  }
}

function enqueueSync(table, payload, onConflict = "sync_id") {
  const queue = store.get("syncQueue", []);
  queue.push({
    table,
    onConflict,
    payload,
    queued_at: nowIsoUtc()
  });
  store.set("syncQueue", queue);
}

async function pushOrQueue(table, payload, onConflict = "sync_id") {
  const auth = store.get("auth", {});
  if (!auth.authorized || !auth.clientId) {
    return { success: false, code: 401, body: "Client not authorized", queued: false };
  }
  const enriched = { ...payload, client_id: auth.clientId };
  const res = await sendUpsertHttp(table, enriched, onConflict);
  if (!res.success) {
    enqueueSync(table, enriched, onConflict);
    return { ...res, queued: true };
  }
  return { ...res, queued: false };
}

async function flushQueue() {
  const queue = store.get("syncQueue", []);
  if (!queue.length) return { synced: 0, remaining: 0 };

  let synced = 0;
  const remaining = [];

  for (const item of queue) {
    const res = await sendUpsertHttp(item.table, item.payload, item.onConflict || "sync_id");
    if (res.success) {
      synced++;
    } else {
      remaining.push(item);
    }
  }
  store.set("syncQueue", remaining);
  return { synced, remaining: remaining.length };
}

function mergeProductLocal(row) {
  const syncId = (row.sync_id || row.id || "").trim();
  const name = (row.name || "").trim();
  if (!name) return;

  const products = store.get("products", []);
  const idx = products.findIndex(
    (p) => (syncId && p.sync_id === syncId) || p.name.toLowerCase() === name.toLowerCase()
  );

  const normalized = {
    id: row.id || (idx >= 0 ? products[idx].id : crypto.randomUUID()),
    sync_id: syncId || (idx >= 0 ? products[idx].sync_id : `prod-${crypto.randomUUID().slice(0, 8)}`),
    name,
    category: (row.category || "General").trim() || "General",
    description: (row.description || "").trim(),
    cost: Number(row.cost ?? 0),
    price: Number(row.price ?? 0),
    stock: Number(row.stock ?? 0),
    unit_type: (row.unit_type || "PIECE").trim() || "PIECE",
    unit_scale: (row.unit_scale || "pcs").trim() || "pcs",
    updated_at: row.updated_at || nowIsoUtc()
  };

  if (idx >= 0) products[idx] = normalized;
  else products.unshift(normalized);
  store.set("products", products);
}

function mergeTableLocal(row) {
  const syncId = (row.sync_id || row.id || "").trim();
  if (!syncId) return;

  const tables = store.get("tables", []);
  const idx = tables.findIndex((t) => t.sync_id === syncId);
  const normalized = {
    sync_id: syncId,
    table_name: (row.table_name || "Table").trim() || "Table",
    status: (row.status || "EMPTY").trim().toUpperCase(),
    active_kot_sync_id: (row.active_kot_sync_id || "").trim(),
    updated_at: row.updated_at || nowIsoUtc()
  };

  if (idx >= 0) tables[idx] = normalized;
  else tables.push(normalized);
  store.set("tables", tables);
}

function mergeKotLocal(row) {
  const syncId = (row.sync_id || row.id || "").trim();
  if (!syncId) return;

  let items = [];
  if (typeof row.items_json === "string" && row.items_json.trim()) {
    try {
      const parsed = JSON.parse(row.items_json);
      if (Array.isArray(parsed)) items = parsed;
    } catch (_) {}
  }

  const kots = store.get("kots", []);
  const idx = kots.findIndex((k) => k.sync_id === syncId);
  const normalized = {
    sync_id: syncId,
    table_sync_id: (row.table_sync_id || "").trim(),
    table_name: (row.table_name || "Takeaway").trim() || "Takeaway",
    status: (row.status || "OPEN").trim().toUpperCase() === "SETTLED" ? "SETTLED" : "ACTIVE",
    items,
    created_at: row.created_at || nowLocalStamp(),
    updated_at: row.updated_at || nowIsoUtc()
  };

  if (idx >= 0) kots[idx] = normalized;
  else kots.unshift(normalized);
  store.set("kots", kots);
}

function mergeBillLocal(row) {
  const syncId = (row.sync_id || row.id || "").trim();
  if (!syncId) return;

  const bills = store.get("bills", []);
  const idx = bills.findIndex((b) => b.sync_id === syncId);
  const normalized = {
    id: row.id || (idx >= 0 ? bills[idx].id : crypto.randomUUID()),
    sync_id: syncId,
    customer_name: (row.customer_name || "Walk-in Customer").trim() || "Walk-in Customer",
    subtotal: Number(row.subtotal ?? 0),
    discount: Number(row.discount ?? 0),
    final_total: Number(row.final_total ?? row.total_amount ?? 0),
    paid_amount: Number(row.paid_amount ?? 0),
    credit_due: Number(row.credit_due ?? 0),
    payment_method: (row.payment_method || "Cash").trim() || "Cash",
    created_at: row.created_at || nowLocalStamp(),
    status: (row.status || "COMPLETED").trim() || "COMPLETED",
    bill_text: row.bill_text || ""
  };

  if (idx >= 0) bills[idx] = normalized;
  else bills.unshift(normalized);
  store.set("bills", bills);
}

function mergeExpenseLocal(row) {
  const syncId = (row.sync_id || row.id || "").trim();
  const title = (row.title || "").trim();
  if (!syncId || !title) return;

  const expenses = store.get("expenses", []);
  const idx = expenses.findIndex((e) => e.sync_id === syncId);
  const normalized = {
    id: row.id || (idx >= 0 ? expenses[idx].id : crypto.randomUUID()),
    sync_id: syncId,
    title,
    category: (row.category || "General").trim() || "General",
    amount: Number(row.amount ?? 0),
    created_at: row.created_at || nowLocalStamp()
  };

  if (idx >= 0) expenses[idx] = normalized;
  else expenses.unshift(normalized);
  store.set("expenses", expenses);
}

async function pullAllFromCloud() {
  const auth = store.get("auth", {});
  if (!auth.authorized || !auth.clientId) {
    return { pulledCount: 0, errorMessage: "Client not authorized" };
  }

  await flushQueue();

  let pulledCount = 0;
  const errors = [];
  const tablesToPull = ["products", "tables", "kots", "bills", "expenses"];
  const encodedClientId = encodeURIComponent(auth.clientId);

  for (const table of tablesToPull) {
    try {
      const url = `${SUPABASE_REST_BASE}/${table}?client_id=eq.${encodedClientId}&select=*`;
      const res = await fetch(url, { method: "GET", headers: getAuthHeaders(false) });
      const body = await res.text();
      if (!res.ok) {
        errors.push(`${table}: HTTP ${res.status}`);
        continue;
      }
      const rows = JSON.parse(body);
      if (!Array.isArray(rows)) continue;

      for (const row of rows) {
        if (table === "products") mergeProductLocal(row);
        else if (table === "tables") mergeTableLocal(row);
        else if (table === "kots") mergeKotLocal(row);
        else if (table === "bills") mergeBillLocal(row);
        else if (table === "expenses") mergeExpenseLocal(row);
        pulledCount++;
      }
    } catch (err) {
      errors.push(`${table}: ${err.message || "Pull failed"}`);
    }
  }

  return { pulledCount, errorMessage: errors.join("; ") };
}

function getFullState() {
  return {
    auth: store.get("auth"),
    settings: store.get("settings"),
    products: store.get("products"),
    tables: store.get("tables"),
    kots: store.get("kots"),
    bills: store.get("bills"),
    expenses: store.get("expenses"),
    customers: store.get("customers"),
    purchases: store.get("purchases"),
    pendingQueueCount: store.get("syncQueue", []).length
  };
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 960,
    minHeight: 640,
    title: "Techbay POS — Desktop",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  mainWindow.loadFile("index.html");
}

ipcMain.handle("pos:get-state", () => getFullState());

ipcMain.handle("pos:authorize", async (_event, { clientId, accessKey }) => {
  const result = await authorizeClient(clientId, accessKey);
  if (result.ok) {
    await pullAllFromCloud();
  }
  return { ...result, state: getFullState() };
});

ipcMain.handle("pos:logout-client", () => {
  store.set("auth", { authorized: false, clientId: "", clientName: "", accessKey: "" });
  return getFullState();
});

ipcMain.handle("pos:sync-now", async () => {
  const pullRes = await pullAllFromCloud();
  return { ...pullRes, state: getFullState() };
});

ipcMain.handle("pos:save-settings", async (_event, settings) => {
  store.set("settings", settings);
  return getFullState();
});

ipcMain.handle("pos:add-table", async (_event, tableName) => {
  const clean = (tableName || "").trim();
  if (!clean) return { ok: false, message: "Enter table name" };

  const slug = clean.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "table";
  const syncId = `tbl-${slug}-${crypto.randomUUID().slice(0, 6)}`;
  const tableObj = {
    sync_id: syncId,
    table_name: clean,
    status: "EMPTY",
    active_kot_sync_id: "",
    updated_at: nowIsoUtc()
  };

  mergeTableLocal(tableObj);
  const syncRes = await pushOrQueue("tables", tableObj, "sync_id");
  return { ok: true, table: tableObj, syncRes, state: getFullState() };
});

ipcMain.handle("pos:add-product", async (_event, prodInput) => {
  const name = (prodInput.name || "").trim();
  const price = Number(prodInput.price ?? 0);
  if (!name || price <= 0) return { ok: false, message: "Enter product name and valid price" };

  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "prod";
  const syncId = `prod-${slug}-${crypto.randomUUID().slice(0, 6)}`;
  const productObj = {
    id: crypto.randomUUID(),
    sync_id: syncId,
    name,
    category: (prodInput.category || "General").trim() || "General",
    description: (prodInput.description || "").trim(),
    cost: Number(prodInput.cost ?? 0),
    price,
    stock: Number(prodInput.stock ?? 0),
    unit_type: prodInput.unit_type || "PIECE",
    unit_scale: prodInput.unit_scale || "pcs",
    updated_at: nowIsoUtc()
  };

  mergeProductLocal(productObj);
  const syncRes = await pushOrQueue("products", productObj, "sync_id");
  return { ok: true, product: productObj, syncRes, state: getFullState() };
});

ipcMain.handle("pos:send-kot", async (_event, { tableSyncId, tableName, items }) => {
  if (!Array.isArray(items) || items.length === 0) {
    return { ok: false, message: "Add items before sending KOT" };
  }

  const tables = store.get("tables", []);
  const kots = store.get("kots", []);
  const cleanTableId = (tableSyncId || "").trim();
  const cleanTableName = (tableName || "Takeaway").trim() || "Takeaway";

  let targetKot = null;
  if (cleanTableId) {
    const tbl = tables.find((t) => t.sync_id === cleanTableId);
    if (tbl && tbl.status === "ACTIVE" && tbl.active_kot_sync_id) {
      targetKot = kots.find((k) => k.sync_id === tbl.active_kot_sync_id && k.status === "ACTIVE");
    }
  }

  if (!targetKot) {
    targetKot = {
      sync_id: crypto.randomUUID(),
      table_sync_id: cleanTableId,
      table_name: cleanTableName,
      status: "ACTIVE",
      items: [],
      created_at: nowLocalStamp(),
      updated_at: nowIsoUtc()
    };
    kots.unshift(targetKot);
  }

  for (const incoming of items) {
    const existing = targetKot.items.find(
      (it) => it.name === incoming.name && Number(it.price) === Number(incoming.price)
    );
    if (existing) {
      existing.qty = Number(existing.qty) + Number(incoming.qty);
    } else {
      targetKot.items.push({ ...incoming });
    }
  }
  targetKot.updated_at = nowIsoUtc();
  store.set("kots", kots);

  let tableSyncRes = null;
  if (cleanTableId) {
    const updatedTable = {
      sync_id: cleanTableId,
      table_name: cleanTableName,
      status: "ACTIVE",
      active_kot_sync_id: targetKot.sync_id,
      updated_at: nowIsoUtc()
    };
    mergeTableLocal(updatedTable);
    tableSyncRes = await pushOrQueue("tables", updatedTable, "sync_id");
  }

  const kotPayload = {
    sync_id: targetKot.sync_id,
    table_sync_id: cleanTableId,
    table_name: cleanTableName,
    status: "OPEN",
    items_json: JSON.stringify(targetKot.items),
    created_at: targetKot.created_at,
    updated_at: targetKot.updated_at
  };
  const kotSyncRes = await pushOrQueue("kots", kotPayload, "sync_id");

  return {
    ok: true,
    kot: targetKot,
    kotSyncRes,
    tableSyncRes,
    state: getFullState()
  };
});

ipcMain.handle("pos:settle-bill", async (_event, billInput) => {
  const bills = store.get("bills", []);
  const nextNumber = bills.length + 1;
  const billUuid = crypto.randomUUID();
  const billSyncId = `desk-${nextNumber}-${crypto.randomUUID().slice(0, 8)}`;
  const stamp = nowLocalStamp();

  const subtotal = Number(billInput.subtotal ?? 0);
  const discount = Number(billInput.discount ?? 0);
  const finalTotal = Math.max(0, Number(billInput.final_total ?? subtotal - discount));
  const method = billInput.payment_method || "Cash";
  const isCredit = method.toLowerCase() === "credit";
  const paidAmount = isCredit ? 0 : finalTotal;
  const creditDue = isCredit ? finalTotal : 0;

  const billObj = {
    id: billUuid,
    bill_number: nextNumber,
    sync_id: billSyncId,
    customer_name: (billInput.customer_name || "Walk-in Customer").trim() || "Walk-in Customer",
    table_name: billInput.table_name || "Takeaway",
    subtotal,
    discount,
    final_total: finalTotal,
    paid_amount: paidAmount,
    credit_due: creditDue,
    payment_method: method,
    created_at: stamp,
    status: "COMPLETED",
    bill_text: billInput.bill_text || ""
  };

  mergeBillLocal(billObj);
  const billSyncRes = await pushOrQueue("bills", billObj, "sync_id");

  // If settled from an active KOT/Table, mark KOT SETTLED and Table EMPTY
  const kotSyncId = (billInput.kot_sync_id || "").trim();
  const tableSyncId = (billInput.table_sync_id || "").trim();
  const tableName = (billInput.table_name || "Takeaway").trim();

  if (kotSyncId) {
    const kots = store.get("kots", []);
    const kot = kots.find((k) => k.sync_id === kotSyncId);
    if (kot) {
      kot.status = "SETTLED";
      kot.updated_at = nowIsoUtc();
      store.set("kots", kots);
    }
    await pushOrQueue("kots", {
      sync_id: kotSyncId,
      table_sync_id: tableSyncId,
      table_name: tableName,
      status: "SETTLED",
      items_json: "[]",
      updated_at: nowIsoUtc()
    }, "sync_id");
  }

  if (tableSyncId) {
    const emptyTable = {
      sync_id: tableSyncId,
      table_name: tableName,
      status: "EMPTY",
      active_kot_sync_id: "",
      updated_at: nowIsoUtc()
    };
    mergeTableLocal(emptyTable);
    await pushOrQueue("tables", emptyTable, "sync_id");
  }

  return { ok: true, bill: billObj, billSyncRes, state: getFullState() };
});

ipcMain.handle("pos:add-expense", async (_event, expInput) => {
  const title = (expInput.title || "").trim();
  const amount = Number(expInput.amount ?? 0);
  if (!title || amount <= 0) return { ok: false, message: "Enter title and amount" };

  const stamp = nowLocalStamp();
  const expObj = {
    id: crypto.randomUUID(),
    sync_id: `exp-${crypto.randomUUID().slice(0, 8)}`,
    title,
    category: (expInput.category || "General").trim() || "General",
    amount,
    created_at: stamp
  };
  mergeExpenseLocal(expObj);
  const syncRes = await pushOrQueue("expenses", expObj, "sync_id");
  return { ok: true, expense: expObj, syncRes, state: getFullState() };
});

ipcMain.handle("pos:add-customer", async (_event, { name, phone }) => {
  const cleanName = (name || "").trim();
  if (!cleanName) return { ok: false, message: "Enter customer name" };
  const customers = store.get("customers", []);
  customers.unshift({ id: crypto.randomUUID(), name: cleanName, phone: (phone || "").trim() });
  store.set("customers", customers);
  return { ok: true, state: getFullState() };
});

ipcMain.handle("pos:add-purchase", async (_event, purInput) => {
  const purchases = store.get("purchases", []);
  const totalAmount = Number(purInput.qty || 0) * Number(purInput.unit_cost || 0);
  const entry = {
    id: purchases.length + 1,
    supplier_name: (purInput.supplier_name || "General Supplier").trim() || "General Supplier",
    product_name: purInput.product_name,
    qty: Number(purInput.qty || 0),
    unit_scale: purInput.unit_scale || "pcs",
    unit_cost: Number(purInput.unit_cost || 0),
    total_amount: totalAmount,
    created_at: nowLocalStamp(),
    status: "COMPLETED"
  };
  purchases.unshift(entry);
  store.set("purchases", purchases);

  const products = store.get("products", []);
  const prod = products.find((p) => p.name.toLowerCase() === String(purInput.product_name || "").toLowerCase());
  if (prod) {
    prod.stock = Number(prod.stock || 0) + Number(purInput.qty || 0);
    prod.updated_at = nowIsoUtc();
    store.set("products", products);
    await pushOrQueue("products", prod, "sync_id");
  }

  return { ok: true, state: getFullState() };
});

ipcMain.handle("pos:print-bill", async () => {
  if (!mainWindow) return { ok: false, message: "No active window" };
  return new Promise((resolve) => {
    mainWindow.webContents.print({ silent: false, printBackground: true }, (success, failureReason) => {
      resolve({ ok: success, message: failureReason || "" });
    });
  });
});

app.whenReady().then(async () => {
  createWindow();
  const auth = store.get("auth", {});
  if (auth.authorized && auth.clientId) {
    await pullAllFromCloud();
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("pos:state-updated", getFullState());
    }
  }
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
