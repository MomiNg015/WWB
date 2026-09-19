import { io } from "socket.io-client";
export const socket = io({
  autoConnect: false,
  auth: { token: localStorage.getItem("gf-session") || "" },
});
export const send = (event: string, payload: unknown = {}) =>
  socket.emit(event, payload);
