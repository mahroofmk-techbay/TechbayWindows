const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("posApi", {
  getAll: () => ipcRenderer.invoke("pos:get-all"),
  saveAll: (nextState) => ipcRenderer.invoke("pos:save-all", nextState),
  syncNow: () => ipcRenderer.invoke("pos:sync-now"),
  printReceipt: () => ipcRenderer.invoke("pos:print-receipt")
});
