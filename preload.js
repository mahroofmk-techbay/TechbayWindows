const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("posApi", {
  getState: () => ipcRenderer.invoke("pos:get-state"),
  authorize: (payload) => ipcRenderer.invoke("pos:authorize", payload),
  logoutClient: () => ipcRenderer.invoke("pos:logout-client"),
  syncNow: () => ipcRenderer.invoke("pos:sync-now"),
  saveSettings: (settings) => ipcRenderer.invoke("pos:save-settings", settings),
  addTable: (tableName) => ipcRenderer.invoke("pos:add-table", tableName),
  addProduct: (prod) => ipcRenderer.invoke("pos:add-product", prod),
  sendKot: (kotData) => ipcRenderer.invoke("pos:send-kot", kotData),
  settleBill: (billData) => ipcRenderer.invoke("pos:settle-bill", billData),
  addExpense: (exp) => ipcRenderer.invoke("pos:add-expense", exp),
  addCustomer: (cust) => ipcRenderer.invoke("pos:add-customer", cust),
  addPurchase: (pur) => ipcRenderer.invoke("pos:add-purchase", pur),
  printBill: () => ipcRenderer.invoke("pos:print-bill"),
  onStateUpdated: (cb) => ipcRenderer.on("pos:state-updated", (_event, state) => cb(state))
});
