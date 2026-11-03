import { FolderOpen, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { RoundTripButton, SyncInspector } from "../inspector/SyncInspector";
import { RunControl, RunPanel } from "../run/RunPanel";
import { requestStop, runStatus } from "../run/runState";
import { useCurrentRun, useRunner } from "../run/useRunner";
import { SidePanel } from "../ui/Sheet";
import { useIsPhone } from "../ui/useIsPhone";
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
import { displayNames } from "./fileTree";
import { languageOf } from "./language";
import { StatusBar } from "./StatusBar";
import type { ConnectionStatus, Person, RoomSession } from "./session";
import { useOpenFiles } from "./useOpenFiles";

interface Props {
  session: RoomSession;
  files: RoomFile[];
  trash: TrashedFile[];
  people: Person[];
  viewOnly: boolean;
  status: ConnectionStatus;
}

// the room's files: the list, this person's tabs, the editor, the status bar and the sync inspector
export function Workspace({ session, files, trash, people, viewOnly, status }: Props) {
  const { tabs, active, openFile, closeFile } = useOpenFiles(session, files, trash);
  const deleted = active && isTrashed(active) ? active : null;
  const runner = useRunner(session);
  const run = useCurrentRun(session);
  const runShows = run && runStatus(run, new Set(session.awareness.getStates().keys()));
  const [hiddenRun, setHiddenRun] = useState<string | null>(null); // whose output I closed
  const [inspecting, setInspecting] = useState(false);
  const phone = useIsPhone();
  const [listing, setListing] = useState(false); // a phone's file list, over the editor
  const show = (id: string) => {
    openFile(id);
    setListing(false);
  };

  function remove(file: RoomFile) {
    deleteFile(session.doc, file.id, session.me);
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
        <SidePanel
          phone={phone}
          title="Files"
          side="left"
          open={!phone || listing}
          onOpenChange={setListing}
        >
          <FileList
            files={files}
            trash={trash}
            activeId={active?.id ?? null}
            people={people}
            canEdit={!viewOnly}
            onOpen={show}
            onCreate={(name) => show(createFile(session.doc, name))}
            onRename={(id, name) => renameFile(session.doc, id, name)}
            onDelete={remove}
            onRestore={(id) => restoreFile(session.doc, id)}
          />
        </SidePanel>
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex h-9 shrink-0 items-center border-b border-line bg-surface">
            {phone && (
              <button
                type="button"
                aria-label="Files"
                onClick={() => setListing(true)}
                className="grid h-full w-10 shrink-0 place-items-center border-r border-line text-muted transition hover:text-fg"
              >
                <FolderOpen size={15} />
              </button>
            )}
            <FileTabs
              tabs={tabs}
              names={displayNames(files)}
              activeId={active?.id ?? null}
              onSelect={openFile}
              onClose={closeFile}
            />
            {!viewOnly && (
              <div className="shrink-0 px-2">
                <RunControl
                  file={active}
                  busy={runShows === "running"}
                  onRun={() => active && runner.run(active, files)}
                  onStop={() => run && requestStop(session.doc, run.id, session.me.name)}
                />
              </div>
            )}
          </div>
          {deleted && (
            <DeletedBanner
              file={deleted}
              byMe={deleted.deletedById === session.me.id}
              onRestore={viewOnly ? undefined : () => restoreFile(session.doc, deleted.id)}
            />
          )}
          <OpenFile
            file={active}
            session={session}
            viewOnly={viewOnly}
            readOnly={viewOnly || deleted !== null}
          />
          {run && runShows && hiddenRun !== run.id && (
            <RunPanel run={run} status={runShows} onHide={() => setHiddenRun(run.id)} />
          )}
        </div>
        <SidePanel
          phone={phone}
          title="Sync inspector"
          side="bottom"
          open={inspecting}
          onOpenChange={setInspecting}
        >
          <SyncInspector sync={session.sync} status={status} onClose={() => setInspecting(false)} />
        </SidePanel>
      </div>
      <StatusBar
        peopleCount={people.length}
        language={active ? (languageOf(active.name)?.name ?? "Plain text") : undefined}
      >
        <RoundTripButton
          sync={session.sync}
          open={inspecting}
          onToggle={() => setInspecting((open) => !open)}
        />
      </StatusBar>
    </>
  );
}

// the open file in the editor, or what to do when none is open
function OpenFile({
  file,
  session,
  viewOnly,
  readOnly,
}: {
  file: RoomFile | null;
  session: RoomSession;
  viewOnly: boolean;
  readOnly: boolean;
}) {
  return (
    <main className="min-h-0 flex-1">
      {file ? (
        <Editor file={file} awareness={session.awareness} readOnly={readOnly} autoFocus />
      ) : (
        <p className="grid h-full place-items-center text-sm text-faint">
          {viewOnly
            ? "Open a file from the list."
            : "Open a file from the list, or make a new one."}
        </p>
      )}
    </main>
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
