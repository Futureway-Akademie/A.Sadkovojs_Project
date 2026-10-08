import { readFile } from "node:fs/promises";
import path from "node:path";

// Fonts of the invoice PDF: Inter 400/500/600 and IBM Plex Mono 500, subset to Latin-1, Latin Extended-A,
// punctuation and € (SIL Open Font License 1.1, see assets/fonts). Read once per server process; the
// directory is added to the route's output trace in next.config.ts.
export type InvoiceFonts = { regular: Uint8Array; medium: Uint8Array; semibold: Uint8Array; mono: Uint8Array };

const FILES = { regular: "Inter-Regular.ttf", medium: "Inter-Medium.ttf", semibold: "Inter-SemiBold.ttf", mono: "IBMPlexMono-Medium.ttf" } as const;

let cached: Promise<InvoiceFonts> | null = null;

export function loadInvoiceFonts(directory = path.join(process.cwd(), "assets", "fonts")): Promise<InvoiceFonts> {
  cached ??= (async () => {
    const entries = await Promise.all(Object.entries(FILES).map(async ([key, file]) => [key, new Uint8Array(await readFile(path.join(directory, file)))] as const));
    return Object.fromEntries(entries) as InvoiceFonts;
  })().catch((error) => {
    cached = null;
    throw error;
  });
  return cached;
}
