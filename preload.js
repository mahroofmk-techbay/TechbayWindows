const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("posApi", {
  getAll: () => ipcRenderer.invoke("db:getAll"),
  saveAll: (data) => ipcRenderer.invoke("db:saveAll", data),
  syncNow: () => ipcRenderer.invoke("cloud:syncNow"),
  printReceipt: () => ipcRenderer.invoke("print:receipt")
});
