import { useEffect, useRef, useState } from "react";

interface Props {
  initial?: string;
  label: string;
  placeholder?: string;
  maxLength: number;
  problem?: (name: string) => string | null; // what's wrong with a name, shown until it's fixed
  onSave: (name: string) => void; // trimmed, changed and without a problem
  onCancel: () => void;
  className?: string; // its size
}

// naming something in place: Enter saves, Escape cancels, and clicking away saves a usable name
// (or quietly cancels)
export function NameField({
  initial = "",
  label,
  placeholder,
  maxLength,
  problem = () => null,
  onSave,
  onCancel,
  className = "",
}: Props) {
  const [value, setValue] = useState(initial);
  const [shown, setShown] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const done = useRef(false); // saving can unmount the field, which may also blur it
  useEffect(() => input.current?.select(), []);

  function finish(ifProblem: "show" | "cancel") {
    if (done.current) return;
    const name = value.trim();
    const wrong = name === "" || name === initial ? null : problem(name);
    if (wrong && ifProblem === "show") {
      setShown(wrong);
      return;
    }
    done.current = true;
    if (name === "" || name === initial || wrong) onCancel();
    else onSave(name);
  }

  return (
    <div>
      <input
        ref={input}
        aria-label={label}
        aria-invalid={shown !== null}
        placeholder={placeholder}
        value={value}
        maxLength={maxLength}
        onChange={(event) => {
          setValue(event.target.value);
          setShown(null);
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault(); // or the key also types a new line where focus goes next
            finish("show");
          }
          if (event.key === "Escape") {
            done.current = true;
            onCancel();
          }
        }}
        onBlur={() => finish("cancel")}
        className={`w-full rounded-md border bg-raised px-2 text-fg outline-none ring-2 ${shown ? "border-red-400/60 ring-red-400/20" : "border-accent/50 ring-accent/20"} ${className}`}
      />
      {shown && (
        <p role="alert" className="mt-1.5 text-[11px] leading-snug text-red-300">
          {shown}
        </p>
      )}
    </div>
  );
}
