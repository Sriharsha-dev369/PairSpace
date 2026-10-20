import { BrowserRouter, Navigate, Route, Routes } from "react-router";
import { RoomPage } from "./pages/RoomPage";
import { newRoomId } from "./room/room-id";

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Navigate to={`/r/${newRoomId()}`} replace />} />
        <Route path="/r/:roomId" element={<RoomPage />} />
      </Routes>
    </BrowserRouter>
  );
}
