import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("attendance", {
  getState: () => ipcRenderer.invoke("getState"),
  onState: (cb) => {
    ipcRenderer.on("state", (_event, state) => cb(state));
  },
  filter: (query) => ipcRenderer.invoke("filter", query),
  assign: (key) => ipcRenderer.invoke("assign", key),
  addMoreScans: () => ipcRenderer.invoke("addMoreScans"),
  rescan: () => ipcRenderer.invoke("rescan"),
  discardScans: () => ipcRenderer.invoke("discardScans"),
  finishEnroll: () => ipcRenderer.invoke("finishEnroll"),
  saveConfig: (config) => ipcRenderer.invoke("saveConfig", config),
  pickFile: (kind) => ipcRenderer.invoke("pickFile", kind),
  openSettings: () => ipcRenderer.invoke("openSettings"),
  clearFingerprints: () => ipcRenderer.invoke("clearFingerprints"),
  undoAttendance: (input) => ipcRenderer.invoke("undoAttendance", input),
  setAttendanceTime: (input) => ipcRenderer.invoke("setAttendanceTime", input),
  closeSettings: () => ipcRenderer.invoke("closeSettings"),
});
