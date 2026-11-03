import { Pencil, Plus } from "lucide-react";
import { useState } from "react";
import { NameField } from "../ui/NameField";
import { FileBadge } from "./FileBadge";
import { fileNameProblem, type RoomFile } from "./files";
import type { Person } from "./session";

interface Props {
  files: RoomFile[];
  activeId: string | null;
  people: Person[];
  canEdit: boolean; // viewers open files, but don't create or rename them
  onOpen: (id: string) => void;
  onCreate: (name: string) => void;
  onRename: (id: string, name: string) => void;
}

const ICON_BUTTON =
  "grid h-6 w-6 shrink-0 place-items-center rounded-md text-faint transition hover:bg-raised hover:text-fg focus-visible:outline-2 focus-visible:outline-accent";

// the room's files, and who is in which
export function FileList({ files, activeId, people, canEdit, onOpen, onCreate, onRename }: Props) {
  const [creating, setCreating] = useState(false);
  const [renaming, setRenaming] = useState<string | null>(null);
  const namesExcept = (id?: string) => files.filter((f) => f.id !== id).map((f) => f.name);

  return (
    <aside
      aria-label="Files"
      className="flex w-36 shrink-0 flex-col border-r border-line bg-surface sm:w-60"
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
        {files.map((file) =>
          renaming === file.id ? (
            <li key={file.id} className="px-2 py-1">
              <NameField
                initial={file.name}
                label="File name"
                maxLength={100}
                problem={(name) => fileNameProblem(name, namesExcept(file.id))}
                onSave={(name) => {
                  setRenaming(null);
                  onRename(file.id, name);
                }}
                onCancel={() => setRenaming(null)}
                className="h-7 text-xs"
              />
            </li>
          ) : (
            <FileRow
              key={file.id}
              file={file}
              active={file.id === activeId}
              here={people.filter((p) => !p.isMe && p.fileId === file.id)}
              canEdit={canEdit}
              onOpen={() => onOpen(file.id)}
              onRename={() => setRenaming(file.id)}
            />
          ),
        )}
      </ul>
    </aside>
  );
}

function FileRow({
  file,
  active,
  here,
  canEdit,
  onOpen,
  onRename,
}: {
  file: RoomFile;
  active: boolean;
  here: Person[]; // everyone else with this file open
  canEdit: boolean;
  onOpen: () => void;
  onRename: () => void;
}) {
  return (
    <li
      className={`group flex h-8 items-center gap-2 pr-2 pl-4 text-[13px] ${active ? "bg-raised text-fg" : "text-muted hover:bg-raised/50 hover:text-fg"}`}
    >
      <button
        type="button"
        onClick={onOpen}
        className="flex h-full min-w-0 flex-1 items-center gap-2 text-left focus-visible:outline-none"
      >
        <FileBadge name={file.name} />
        <span className="truncate">{file.name}</span>
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
        <button
          type="button"
          aria-label={`Rename ${file.name}`}
          title="Rename"
          onClick={onRename}
          className={`${ICON_BUTTON} opacity-0 group-hover:opacity-100 focus-visible:opacity-100`}
        >
          <Pencil size={12} />
        </button>
      )}
    </li>
  );
}
