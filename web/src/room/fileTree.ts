import type { RoomFile } from "./files";

// how the file list shows files. Folders exist only here: in the room's document a file's name
// may contain "/", and that's all
export type TreeNode =
  | { kind: "folder"; name: string; path: string; children: TreeNode[] }
  | { kind: "file"; name: string; file: RoomFile }; // name: shown, without its folders

type Folder = Extract<TreeNode, { kind: "folder" }>;

// "utils.js", 2 -> "utils (2).js"; "README" -> "README (2)"; ".env" -> ".env (2)"
function numbered(name: string, n: number): string {
  const dot = name.lastIndexOf(".");
  return dot > name.lastIndexOf("/") + 1
    ? `${name.slice(0, dot)} (${n})${name.slice(dot)}`
    : `${name} (${n})`;
}

// the first "name (n)" from `n` up that no file really has and nothing else is shown as
function freeName(name: string, n: number, taken: Set<string>): string {
  let candidate = numbered(name, n);
  while (taken.has(candidate)) candidate = numbered(name, ++n);
  return candidate;
}

// the name each file is shown with: its own, or "name (2).ext" when an older file has that name.
// Older: made first, then by id, so it's the same for everyone
export function displayNames(files: RoomFile[]): Map<string, string> {
  const taken = new Set(files.map((file) => file.name));
  const seen = new Map<string, number>();
  const names = new Map<string, string>();
  const oldestFirst = [...files].sort(
    (a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id),
  );
  for (const file of oldestFirst) {
    const count = (seen.get(file.name) ?? 0) + 1;
    seen.set(file.name, count);
    const shown = count === 1 ? file.name : freeName(file.name, count, taken);
    taken.add(shown);
    names.set(file.id, shown);
  }
  return names;
}

function subfolder(parent: Folder, name: string): Folder {
  const existing = parent.children.find(
    (node): node is Folder => node.kind === "folder" && node.name === name,
  );
  if (existing) return existing;
  const path = parent.path ? `${parent.path}/${name}` : name;
  const folder: Folder = { kind: "folder", name, path, children: [] };
  parent.children.push(folder);
  return folder;
}

// folders first, then files, each in alphabetical order, all the way down
function sorted(nodes: TreeNode[]): TreeNode[] {
  return nodes
    .map((node) => (node.kind === "folder" ? { ...node, children: sorted(node.children) } : node))
    .sort((a, b) =>
      a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === "folder" ? -1 : 1,
    );
}

// the files grouped by the folders in their names
export function fileTree(files: RoomFile[]): TreeNode[] {
  const names = displayNames(files);
  const root: Folder = { kind: "folder", name: "", path: "", children: [] };
  for (const file of files) {
    const parts = (names.get(file.id) ?? file.name).split("/");
    const name = parts.pop() ?? file.name;
    const folder = parts.reduce(subfolder, root);
    folder.children.push({ kind: "file", name, file });
  }
  return sorted(root.children);
}
