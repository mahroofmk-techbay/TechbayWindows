const { app, BrowserWindow, ipcMain } = require("electron");
const path = require("path");
const fs = require("fs");

const dbPath = path.join(app.getPath("userData"), "pos_local_db.json");

const defaultData = {
  company: {
    name: "My Business",
    address: "Main Street",
    phone: "",
    taxId: "",
    cloudEndpoint: "",
    cloudApiKey: ""
  },
  products: [],      // { id, sku, name, salePrice, purchasePrice, stock }
  customers: [],     // { id, name, phone, email, address }
  sales: [],         // { id, receiptNo, customerId, customerName, items, total, date }
  saleReturns: [],   // { id, saleId, receiptNo, items, refundAmount, date }
  purchases: [],     // { id, supplier, items, total, date }
  purchaseReturns: [], // { id, purchaseId, items, refundAmount, date }
  syncQueue: []      // Pending offline operations ready for cloud sync
};

function readDb() {
  if (!fs.existsSync(dbPath)) {
    fs.writeFileSync(dbPath, JSON.stringify(defaultData, null, 2), "utf8");
  }
  return JSON.parse(fs.readFileSync(dbPath, "utf8"));
}

function writeDb(data) {
  fs.writeFileSync(dbPath, JSON.stringify(data, null, 2), "utf8");
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  win.loadFile(path.join(__dirname, "renderer", "index.html"));
}

ipcMain.handle("db:getAll", () => readDb());

ipcMain.handle("db:saveAll", (_event, nextData) => {
  writeDb(nextData);
  return { ok: true, dbPath };
});

// Hook for future cloud sync: sends pending syncQueue items when online
ipcMain.handle("cloud:syncNow", async () => {
  const db = readDb();
  const endpoint = (db.company.cloudEndpoint || "").trim();
  if (!endpoint) {
    return {
      ok: false,
      message: "Set a Cloud Sync Endpoint URL in Company Setup first. Pending items remain queued locally.",
      pendingCount: db.syncQueue.length
    };
  }

  try {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(db.company.cloudApiKey ? { Authorization: `Bearer ${db.company.cloudApiKey}` } : {})
      },
      body: JSON.stringify({
        company: db.company.name,
        syncedAt: new Date().toISOString(),
        queue: db.syncQueue
      })
    });

    if (!res.ok) {
      return { ok: false, message: `Cloud server returned HTTP ${res.status}`, pendingCount: db.syncQueue.length };
    }

    const syncedCount = db.syncQueue.length;
    db.syncQueue = [];
    writeDb(db);
    return { ok: true, message: `Synced ${syncedCount} offline record(s) to cloud.` };
  } catch (err) {
    return { ok: false, message: `Offline or unreachable: ${err.message}`, pendingCount: db.syncQueue.length };
  }
});

ipcMain.handle("print:receipt", async (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  return new Promise((resolve) => {
    win.webContents.print({ silent: false, printBackground: true }, (success, failureReason) => {
      resolve({ ok: success, error: failureReason || "" });
    });
  });
});

app.whenReady().then(() => {
  readDb();
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
