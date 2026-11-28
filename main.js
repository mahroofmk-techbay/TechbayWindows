const { app, BrowserWindow, ipcMain } = require("electron");
const path = require("path");
const crypto = require("crypto");
const Store = require("electron-store");

const store = new Store({
  name: "techbay-pos-store"
});

const DEFAULT_SUPABASE_URL = "https://ibqdujwkwgqptajgpjll.supabase.co/rest/v1";
const DEFAULT_SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImlicWR1andrd2dxcHRhamdwamxsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTU2Nzk3ODMsImV4cCI6MjExMTI1NTc4M30.KmPNvy8aEnL3GyYS03lS0dW7slnRMaddIN0B0N_qw30";

const defaultState = {
  auth: {
    authorized: false,
    clientId: "",
    clientName: "",
    accessKey: ""
  },
  company: {
    name: "Techbay Store",
    phone: "",
    taxId: "",
    address: "",
    cloudEndpoint: DEFAULT_SUPABASE_URL,
    cloudApiKey: DEFAULT_SUPABASE_ANON_KEY
  },
  products: [],
  customers: [],
  sales: [],
  saleReturns: [],
  purchases: [],
  purchaseReturns: [],
  tables: [
    { sync_id: "tbl-1", table_name: "Table 1", status: "EMPTY", active_kot_sync_id: "" },
    { sync_id: "tbl-2", table_name: "Table 2", status: "EMPTY", active_kot_sync_id: "" },
    { sync_id: "tbl-3", table_name: "Table 3", status: "EMPTY", active_kot_sync_id: "" },
    { sync_id: "tbl-4", table_name: "Table 4", status: "EMPTY", active_kot_sync_id: "" },
    { sync_id: "tbl-5", table_name: "Table 5", status: "EMPTY", active_kot_sync_id: "" },
    { sync_id: "tbl-6", table_name: "Table 6", status: "EMPTY", active_kot_sync_id: "" }
  ],
  kots: [],
  syncQueue: []
};

let mainWindow = null;

function getAppState() {
  const saved = store.get("posState", {});
  return {
    ...defaultState,
    ...saved,
    auth: { ...defaultState.auth, ...(saved.auth || {}) },
    company: { ...defaultState.company, ...(saved.company || {}) },
    products: Array.isArray(saved.products) ? saved.products : [],
    customers: Array.isArray(saved.customers) ? saved.customers : [],
    sales: Array.isArray(saved.sales) ? saved.sales : [],
    saleReturns: Array.isArray(saved.saleReturns) ? saved.saleReturns : [],
    purchases: Array.isArray(saved.purchases) ? saved.purchases : [],
    purchaseReturns: Array.isArray(saved.purchaseReturns) ? saved.purchaseReturns : [],
    tables: Array.isArray(saved.tables) && saved.tables.length ? saved.tables : defaultState.tables,
    kots: Array.isArray(saved.kots) ? saved.kots : [],
    syncQueue: Array.isArray(saved.syncQueue) ? saved.syncQueue : []
  };
}

function saveAppState(nextState) {
  const merged = getAppState();
  const updated = {
    ...merged,
    ...(nextState || {}),
    auth: { ...merged.auth, ...((nextState && nextState.auth) || {}) },
    company: { ...merged.company, ...((nextState && nextState.company) || {}) }
  };
  store.set("posState", updated);
  return updated;
}

function getSupabaseConfig(state) {
  const rawBase = (state.company && state.company.cloudEndpoint) || DEFAULT_SUPABASE_URL;
  const trimmedBase = rawBase.trim().replace(/\/+$/, "");
  const restBase = trimmedBase.endsWith("/rest/v1") ? trimmedBase : `${trimmedBase}/rest/v1`;
  const apiKey = ((state.company && state.company.cloudApiKey) || DEFAULT_SUPABASE_ANON_KEY).trim();
  return { restBase, apiKey };
}

function getHeaders(apiKey, includePrefer = false) {
  const headers = {
    apikey: apiKey,
    Authorization: `Bearer ${apiKey}`
  };
  if (includePrefer) {
    headers["Content-Type"] = "application/json";
    headers["Prefer"] = "resolution=merge-duplicates,return=representation";
  }
  return headers;
}

function mapQueueItemToSupabase(item, clientId) {
  const entity = (item.entity || "").toLowerCase();
  const p = item.payload || {};
  const nowIso = new Date().toISOString();

  if (entity === "product") {
    const syncId = p.sync_id || p.id || `prod-${crypto.randomUUID().slice(0, 8)}`;
    return {
      table: "products",
      onConflict: "sync_id",
      row: {
        client_id: clientId,
        id: p.id || syncId,
        sync_id: syncId,
        name: p.name || "",
        category: p.category || "General",
        description: p.description || p.sku || "",
        cost: Number(p.cost ?? p.purchasePrice ?? 0),
        price: Number(p.price ?? p.salePrice ?? 0),
        stock: Number(p.stock ?? 0),
        unit_type: p.unit_type || "PIECE",
        unit_scale: p.unit_scale || "pcs",
        updated_at: nowIso
      }
    };
  }

  if (entity === "sale") {
    const syncId = p.sync_id || p.id || `sale-${crypto.randomUUID().slice(0, 8)}`;
    const subtotal = Number(p.subtotal ?? p.total ?? 0);
    const discount = Number(p.discount ?? 0);
    const finalTotal = Number(p.final_total ?? p.total ?? Math.max(0, subtotal - discount));
    const method = p.payment_method || "Cash";
    const isCredit = method.toLowerCase() === "credit";
    return {
      table: "bills",
      onConflict: "sync_id",
      row: {
        client_id: clientId,
        id: p.id || syncId,
        sync_id: syncId,
        customer_name: p.customer_name || p.customerName || "Walk-in Customer",
        subtotal,
        discount,
        final_total: finalTotal,
        paid_amount: Number(p.paid_amount ?? (isCredit ? 0 : finalTotal)),
        credit_due: Number(p.credit_due ?? (isCredit ? finalTotal : 0)),
        payment_method: method,
        created_at: p.created_at || p.date || nowIso,
        status: p.status || "COMPLETED",
        bill_text: p.bill_text || ""
      }
    };
  }

  if (entity === "table") {
    const syncId = p.sync_id || p.id || `tbl-${crypto.randomUUID().slice(0, 8)}`;
    return {
      table: "tables",
      onConflict: "sync_id",
      row: {
        client_id: clientId,
        sync_id: syncId,
        table_name: p.table_name || p.name || "Table",
        status: p.status || "EMPTY",
        active_kot_sync_id: p.active_kot_sync_id || "",
        updated_at: nowIso
      }
    };
  }

  if (entity === "kot") {
    const syncId = p.sync_id || p.id || crypto.randomUUID();
    return {
      table: "kots",
      onConflict: "sync_id",
      row: {
        client_id: clientId,
        sync_id: syncId,
        table_sync_id: p.table_sync_id || "",
        table_name: p.table_name || "Takeaway",
        status: p.status || "OPEN",
        items_json: typeof p.items_json === "string" ? p.items_json : JSON.stringify(p.items || []),
        created_at: p.created_at || nowIso,
        updated_at: nowIso
      }
    };
  }

  return null;
}

async function syncNowWithSupabase() {
  let state = getAppState();
  const { restBase, apiKey } = getSupabaseConfig(state);
  const clientId = (state.auth && state.auth.clientId ? state.auth.clientId : state.company.taxId || "").trim();

  if (!clientId) {
    return { ok: false, message: "Set Client ID in Setup/Auth before syncing." };
  }

  const remainingQueue = [];
  let pushedCount = 0;

  for (const item of state.syncQueue) {
    const mapped = mapQueueItemToSupabase(item, clientId);
    if (!mapped) continue;

    try {
      const endpoint = `${restBase}/${mapped.table}?on_conflict=${encodeURIComponent(mapped.onConflict)}`;
      const res = await fetch(endpoint, {
        method: "POST",
        headers: getHeaders(apiKey, true),
        body: JSON.stringify(mapped.row)
      });
      if (res.ok) {
        pushedCount++;
      } else {
        remainingQueue.push(item);
      }
    } catch (_) {
      remainingQueue.push(item);
    }
  }

  state = saveAppState({ ...state, syncQueue: remainingQueue });

  let pulledProducts = 0;
  let pulledBills = 0;

  try {
    const prodUrl = `${restBase}/products?client_id=eq.${encodeURIComponent(clientId)}&select=*`;
    const prodRes = await fetch(prodUrl, { method: "GET", headers: getHeaders(apiKey, false) });
    if (prodRes.ok) {
      const remoteProducts = await prodRes.json();
      if (Array.isArray(remoteProducts)) {
        const localProducts = [...state.products];
        for (const rp of remoteProducts) {
          const syncId = (rp.sync_id || rp.id || "").trim();
          const name = (rp.name || "").trim();
          if (!name) continue;
          const idx = localProducts.findIndex(
            (lp) => (syncId && lp.sync_id === syncId) || lp.name.toLowerCase() === name.toLowerCase()
          );
          const mergedProd = {
            id: idx >= 0 ? localProducts[idx].id : rp.id || syncId || `P_${Date.now()}_${pulledProducts}`,
            sync_id: syncId || (idx >= 0 ? localProducts[idx].sync_id : ""),
            sku: idx >= 0 ? localProducts[idx].sku : rp.description || "SKU",
            name,
            purchasePrice: Number(rp.cost ?? 0),
            salePrice: Number(rp.price ?? 0),
            stock: Number(rp.stock ?? 0)
          };
          if (idx >= 0) localProducts[idx] = mergedProd;
          else localProducts.push(mergedProd);
          pulledProducts++;
        }
        state = saveAppState({ ...state, products: localProducts });
      }
    }

    const billUrl = `${restBase}/bills?client_id=eq.${encodeURIComponent(clientId)}&select=*`;
    const billRes = await fetch(billUrl, { method: "GET", headers: getHeaders(apiKey, false) });
    if (billRes.ok) {
      const remoteBills = await billRes.json();
      if (Array.isArray(remoteBills)) {
        const localSales = [...state.sales];
        for (const rb of remoteBills) {
          const syncId = (rb.sync_id || rb.id || "").trim();
          if (!syncId) continue;
          const idx = localSales.findIndex((ls) => ls.sync_id === syncId || ls.id === syncId);
          const totalVal = Number(rb.final_total ?? rb.total_amount ?? 0);
          const mergedSale = {
            id: idx >= 0 ? localSales[idx].id : rb.id || syncId,
            sync_id: syncId,
            receiptNo: idx >= 0 ? localSales[idx].receiptNo : `RCPT-${syncId.slice(0, 8)}`,
            customerId: null,
            customerName: rb.customer_name || "Walk-in Customer",
            productName: idx >= 0 ? localSales[idx].productName : "Synced Bill",
            qty: idx >= 0 ? localSales[idx].qty : 1,
            unitPrice: idx >= 0 ? localSales[idx].unitPrice : totalVal,
            total: totalVal,
            date: String(rb.created_at || new Date().toISOString()).slice(0, 10)
          };
          if (idx >= 0) localSales[idx] = mergedSale;
          else localSales.push(mergedSale);
          pulledBills++;
        }
        state = saveAppState({ ...state, sales: localSales });
      }
    }
  } catch (err) {
    return {
      ok: false,
      message: `Pushed ${pushedCount}, pull error: ${err.message || "network error"}`
    };
  }

  return {
    ok: true,
    message: `Synced (pushed ${pushedCount}, pulled ${pulledProducts} products, ${pulledBills} bills; pending ${state.syncQueue.length})`
  };
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 960,
    minHeight: 640,
    title: "Techbay POS",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  mainWindow.loadFile(path.join(__dirname, "renderer", "index.html"));
}

ipcMain.handle("pos:get-all", () => getAppState());

ipcMain.handle("pos:save-all", (_event, nextState) => {
  saveAppState(nextState);
  return true;
});

ipcMain.handle("pos:sync-now", async () => {
  return await syncNowWithSupabase();
});

ipcMain.handle("pos:print-receipt", async () => {
  if (!mainWindow) return { ok: false };
  return new Promise((resolve) => {
    mainWindow.webContents.print({ silent: false, printBackground: true }, (success, failureReason) => {
      resolve({ ok: success, error: failureReason || "" });
    });
  });
});

app.whenReady().then(() => {
  createWindow();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
