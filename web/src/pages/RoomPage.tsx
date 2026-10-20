import { useParams } from "react-router";

export function RoomPage() {
  const { roomId } = useParams();
  return <h1 className="p-8 text-3xl font-semibold tracking-tight">Room {roomId}</h1>;
}
