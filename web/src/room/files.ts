import * as Y from "yjs";
import { randomId } from "./randomId";

// in the room's document: files = Y.Map<id, Y.Map{ name: string, content: Y.Text }>
export interface RoomFile {
  id: string;
  name: string; // may contain "/": the file list groups by it, but there are no real folders
  content: Y.Text;
}

const MAX_NAME = 100;

const filesOf = (doc: Y.Doc) => doc.getMap<Y.Map<unknown>>("files");

// every file in the room, by name
export function listFiles(doc: Y.Doc): RoomFile[] {
  return [...filesOf(doc).entries()]
    .map(([id, file]) => ({
      id,
      name: file.get("name") as string,
      content: file.get("content") as Y.Text,
    }))
    .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
}

// what's wrong with a file name, said so it can be fixed; null if it's fine. `taken`: other files'
export function fileNameProblem(name: string, taken: string[]): string | null {
  if (name.trim() === "") return "Give the file a name.";
  if (name !== name.trim()) return "A name can't start or end with a space.";
  if (name.length > MAX_NAME) return `Keep the name to ${MAX_NAME} characters.`;
  if (name.split("/").some((part) => part === "" || part === "." || part === "..")) {
    return "Use folder/name.ext: no empty, “.” or “..” folder names.";
  }
  if (taken.includes(name)) return "There's already a file with this name.";
  return null;
}

function checkName(name: string, taken: string[]) {
  const problem = fileNameProblem(name, taken);
  if (problem) throw new Error(problem);
}

// a new, empty file; returns its id
export function createFile(doc: Y.Doc, name: string): string {
  checkName(
    name,
    listFiles(doc).map((file) => file.name),
  );
  const id = randomId(16);
  const file = new Y.Map<unknown>();
  file.set("name", name);
  file.set("content", new Y.Text());
  filesOf(doc).set(id, file);
  return id;
}

export function renameFile(doc: Y.Doc, id: string, name: string) {
  const file = filesOf(doc).get(id);
  if (!file) throw new Error(`no file ${id}`);
  checkName(
    name,
    listFiles(doc)
      .filter((other) => other.id !== id)
      .map((other) => other.name),
  );
  file.set("name", name);
}
