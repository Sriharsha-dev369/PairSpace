import { LanguageDescription } from "@codemirror/language";
import { languages } from "@codemirror/language-data";

// the language a file is written in, from its name (src/app.py: Python); null if none is known.
// Each language's code loads only when a file needs it
export const languageOf = (name: string) => LanguageDescription.matchFilename(languages, name);
