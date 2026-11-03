import { ChevronRight, Pencil, Plus, RotateCcw, Trash2 } from "lucide-react";
import { useState } from "react";
import { timeAgo } from "../timeAgo";
import { NameField } from "../ui/NameField";
import { FileBadge } from "./FileBadge";
import { fileNameProblem, type RoomFile, type TrashedFile } from "./files";
import { fileTree, type TreeNode } from "./fileTree";
import type { Person } from "./session";

interface Props {
  files: RoomFile[];
  trash: TrashedFile[];
  activeId: string | null;
  people: Person[];
  canEdit: boolean; // viewers open files, but don't create, rename, delete or restore them
  onOpen: (id: string) => void;
  onCreate: (name: string) => void;
  onRename: (id: string, name: string) => void;
  onDelete: (file: RoomFile) => void;
  onRestore: (id: string) => void;
}

// what every row of the tree needs to know and do
interface Rows {
  activeId: string | null;
  people: Person[];
  canEdit: boolean;
  renaming: string | null;
  collapsed: Set<string>; // folder paths
  toggle: (path: string) => void;
  open: (id: string) => void;
  startRename: (id: string) => void;
  endRename: () => void;
  rename: (id: string, name: string) => void;
  remove: (file: RoomFile) => void;
  namesExcept: (id?: string) => string[];
}

// folders are indented by depth; a row's own padding comes on top
const indent = (depth: number, base: number) => ({ paddingLeft: base + depth * 12 });

const ICON_BUTTON =
  "grid h-6 w-6 shrink-0 place-items-center rounded-md text-faint transition hover:bg-raised hover:text-fg focus-visible:outline-2 focus-visible:outline-accent";

// the room's files, and who is in which
export function FileList({
  files,
  trash,
  activeId,
  people,
  canEdit,
  onOpen,
  onCreate,
  onRename,
  onDelete,
  onRestore,
}: Props) {
  const [creating, setCreating] = useState(false);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState(new Set<string>());
  const namesExcept = (id?: string) => files.filter((f) => f.id !== id).map((f) => f.name);
  const rows: Rows = {
    activeId,
    people,
    canEdit,
    renaming,
    collapsed,
    toggle: (path) =>
      setCollapsed((before) => {
        const after = new Set(before);
        if (!after.delete(path)) after.add(path);
        return after;
      }),
    open: onOpen,
    startRename: setRenaming,
    endRename: () => setRenaming(null),
    rename: (id, name) => {
      setRenaming(null);
      onRename(id, name);
    },
    remove: onDelete,
    namesExcept,
  };

  return (
    <aside
      aria-label="Files"
      className="flex w-full shrink-0 flex-col border-line bg-surface md:w-60 md:border-r"
    >
      <div className="flex h-9 shrink-0 items-center justify-between border-b border-line pr-2 pl-4">
        <h2 className="text-xs font-semibold text-muted">Files</h2>
        {canEdit && (
          <button
            type="button"
            aria-label="New file"
            title="New file"
            onClick={() => setCreating(true)}
            className={ICON_BUTTON}
          >
            <Plus size={14} />
          </button>
        )}
      </div>
      <ul className="min-h-0 flex-1 overflow-y-auto py-1.5">
        {creating && (
          <li className="px-2 py-1">
            <NameField
              label="File name"
              placeholder="name.js"
              maxLength={100}
              problem={(name) => fileNameProblem(name, namesExcept())}
              onSave={(name) => {
                setCreating(false);
                onCreate(name);
              }}
              onCancel={() => setCreating(false)}
              className="h-7 text-xs"
            />
          </li>
        )}
        <Nodes nodes={fileTree(files)} depth={0} rows={rows} />
      </ul>
      {trash.length > 0 && <Trash files={trash} canRestore={canEdit} onRestore={onRestore} />}
    </aside>
  );
}

function Nodes({ nodes, depth, rows }: { nodes: TreeNode[]; depth: number; rows: Rows }) {
  return nodes.map((node) =>
    node.kind === "folder" ? (
      <FolderRow key={`folder:${node.path}`} folder={node} depth={depth} rows={rows} />
    ) : (
      <FileItem key={node.file.id} node={node} depth={depth} rows={rows} />
    ),
  );
}

// a folder exists only in the list: it's the shared start of some files' names
function FolderRow({
  folder,
  depth,
  rows,
}: {
  folder: Extract<TreeNode, { kind: "folder" }>;
  depth: number;
  rows: Rows;
}) {
  const open = !rows.collapsed.has(folder.path);
  return (
    <li>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => rows.toggle(folder.path)}
        style={indent(depth, 12)}
        className="flex h-8 w-full items-center gap-1.5 pr-2 text-left text-[13px] text-muted transition hover:bg-raised/50 hover:text-fg"
      >
        <ChevronRight size={12} className={`shrink-0 transition ${open ? "rotate-90" : ""}`} />
        <span className="truncate">{folder.name}</span>
      </button>
      {open && (
        <ul>
          <Nodes nodes={folder.children} depth={depth + 1} rows={rows} />
        </ul>
      )}
    </li>
  );
}

function FileItem({
  node,
  depth,
  rows,
}: {
  node: Extract<TreeNode, { kind: "file" }>;
  depth: number;
  rows: Rows;
}) {
  const { file } = node;
  if (rows.renaming === file.id) {
    return (
      <li className="py-1 pr-2" style={indent(depth, 8)}>
        <NameField
          initial={file.name}
          label="File name"
          maxLength={100}
          problem={(name) => fileNameProblem(name, rows.namesExcept(file.id))}
          onSave={(name) => rows.rename(file.id, name)}
          onCancel={rows.endRename}
          className="h-7 text-xs"
        />
      </li>
    );
  }
  return (
    <FileRow
      file={file}
      shown={node.name}
      depth={depth}
      active={file.id === rows.activeId}
      here={rows.people.filter((p) => !p.isMe && p.fileId === file.id)}
      canEdit={rows.canEdit}
      onOpen={() => rows.open(file.id)}
      onRename={() => rows.startRename(file.id)}
      onDelete={() => rows.remove(file)}
    />
  );
}

function FileRow({
  file,
  shown,
  depth,
  active,
  here,
  canEdit,
  onOpen,
  onRename,
  onDelete,
}: {
  file: RoomFile;
  shown: string; // its name in the list: without its folders, and "(2)" if it's a duplicate
  depth: number;
  active: boolean;
  here: Person[]; // everyone else with this file open
  canEdit: boolean;
  onOpen: () => void;
  onRename: () => void;
  onDelete: () => void;
}) {
  const onHover = `${ICON_BUTTON} opacity-0 group-hover:opacity-100 focus-visible:opacity-100`;
  return (
    <li
      style={indent(depth, 16)}
      className={`group flex h-8 items-center gap-2 pr-2 text-[13px] ${active ? "bg-raised text-fg" : "text-muted hover:bg-raised/50 hover:text-fg"}`}
    >
      <button
        type="button"
        onClick={onOpen}
        title={file.name}
        className="flex h-full min-w-0 flex-1 items-center gap-2 text-left focus-visible:outline-none"
      >
        <FileBadge name={file.name} />
        <span data-testid="file-name" className="truncate">
          {shown}
        </span>
      </button>
      {here.length > 0 && (
        <span className="flex -space-x-0.5">
          {here.map((person) => (
            <span
              key={person.id}
              role="img"
              aria-label={`${person.name} is in this file`}
              title={`${person.name} is in this file`}
              className="h-2 w-2 rounded-full ring-2 ring-surface"
              style={{ backgroundColor: person.color }}
            />
          ))}
        </span>
      )}
      {canEdit && (
        <>
          <button
            type="button"
            aria-label={`Rename ${file.name}`}
            title="Rename"
            onClick={onRename}
            className={onHover}
          >
            <Pencil size={12} />
          </button>
          <button
            type="button"
            aria-label={`Delete ${file.name}`}
            title="Delete (it goes to the trash)"
            onClick={onDelete}
            className={`${onHover} hover:text-red-300`}
          >
            <Trash2 size={12} />
          </button>
        </>
      )}
    </li>
  );
}

// deleted files, which anyone who can edit brings back
function Trash({
  files,
  canRestore,
  onRestore,
}: {
  files: TrashedFile[];
  canRestore: boolean;
  onRestore: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="shrink-0 border-t border-line">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className="flex h-9 w-full items-center gap-1.5 px-4 text-xs font-semibold text-muted transition hover:text-fg"
      >
        <ChevronRight size={12} className={`transition ${open ? "rotate-90" : ""}`} />
        Trash ({files.length})
      </button>
      {open && (
        <ul className="max-h-56 overflow-y-auto pb-2">
          {files.map((file) => (
            <li key={file.id} className="flex items-center gap-2 py-1 pr-2 pl-4 text-[13px]">
              <FileBadge name={file.name} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-muted">{file.name}</span>
                <span className="block truncate text-[11px] text-faint">
                  Deleted {timeAgo(file.deletedAt)} by {file.deletedBy}
                </span>
              </span>
              {canRestore && (
                <button
                  type="button"
                  aria-label={`Restore ${file.name}`}
                  title="Restore"
                  onClick={() => onRestore(file.id)}
                  className={ICON_BUTTON}
                >
                  <RotateCcw size={12} />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
