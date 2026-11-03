import { Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Editor } from "./Editor";
import { FileList } from "./FileList";
import { FileTabs } from "./FileTabs";
import {
  createFile,
  deleteFile,
  isTrashed,
  type RoomFile,
  renameFile,
  restoreFile,
  type TrashedFile,
} from "./files";
import { languageOf } from "./language";
import { StatusBar } from "./StatusBar";
import type { Person, RoomSession } from "./session";
import { useOpenFiles } from "./useOpenFiles";

interface Props {
  session: RoomSession;
  files: RoomFile[];
  trash: TrashedFile[];
  people: Person[];
  viewOnly: boolean;
}

// the room's files: the list, this person's tabs, the editor, and the status bar
export function Workspace({ session, files, trash, people, viewOnly }: Props) {
  const { tabs, active, openFile, closeFile } = useOpenFiles(session, files, trash);
  const deleted = active && isTrashed(active) ? active : null;

  function remove(file: RoomFile) {
    deleteFile(session.doc, file.id, session.me.name);
    closeFile(file.id);
    toast(`Deleted ${file.name}`, {
      description: "It's in the trash.",
      action: {
        label: "Undo",
        onClick: () => {
          restoreFile(session.doc, file.id);
          openFile(file.id);
        },
      },
    });
  }

  return (
    <>
      <div className="flex min-h-0 flex-1">
        <FileList
          files={files}
          trash={trash}
          activeId={active?.id ?? null}
          people={people}
          canEdit={!viewOnly}
          onOpen={openFile}
          onCreate={(name) => openFile(createFile(session.doc, name))}
          onRename={(id, name) => renameFile(session.doc, id, name)}
          onDelete={remove}
          onRestore={(id) => restoreFile(session.doc, id)}
        />
        <div className="flex min-w-0 flex-1 flex-col">
          <FileTabs
            tabs={tabs}
            activeId={active?.id ?? null}
            onSelect={openFile}
            onClose={closeFile}
          />
          {deleted && (
            <DeletedBanner
              file={deleted}
              byMe={deleted.deletedBy === session.me.name}
              onRestore={viewOnly ? undefined : () => restoreFile(session.doc, deleted.id)}
            />
          )}
          <main className="min-h-0 flex-1">
            {active ? (
              <Editor
                file={active}
                awareness={session.awareness}
                readOnly={viewOnly || deleted !== null}
                autoFocus
              />
            ) : (
              <p className="grid h-full place-items-center text-sm text-faint">
                {viewOnly
                  ? "Open a file from the list."
                  : "Open a file from the list, or make a new one."}
              </p>
            )}
          </main>
        </div>
      </div>
      <StatusBar
        peopleCount={people.length}
        language={active ? (languageOf(active.name)?.name ?? "Plain text") : undefined}
      />
    </>
  );
}

// the file someone has open was deleted (by someone else, usually): say who, and offer it back
function DeletedBanner({
  file,
  byMe,
  onRestore,
}: {
  file: TrashedFile;
  byMe: boolean;
  onRestore?: () => void; // viewers can't restore
}) {
  return (
    <div className="flex shrink-0 items-center gap-2.5 border-b border-line bg-amber-400/[0.07] px-4 py-2 text-[13px]">
      <Trash2 size={14} className="shrink-0 text-amber-300" />
      <span className="font-medium">{byMe ? "You" : file.deletedBy} deleted this file.</span>
      <span className="hidden text-muted md:inline">
        Everything in it is kept{onRestore ? ": restore it to keep editing." : "."}
      </span>
      {onRestore && (
        <button
          type="button"
          onClick={onRestore}
          className="ml-auto h-7 shrink-0 rounded-md bg-accent px-2.5 text-xs font-semibold text-canvas transition hover:brightness-110"
        >
          Restore
        </button>
      )}
    </div>
  );
}
