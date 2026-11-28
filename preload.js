const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("posApi", {
  getAll: () => ipcRenderer.invoke("pos:get-all"),
  saveAll: (nextState) => ipcRenderer.invoke("pos:save-all", nextState),
  authorizeClient: (creds) => ipcRenderer.invoke("pos:authorize-client", creds),
  logoutClient: () => ipcRenderer.invoke("pos:logout-client"),
  syncNow: () => ipcRenderer.invoke("pos:sync-now"),
  printReceipt: () => ipcRenderer.invoke("pos:print-receipt")
});
