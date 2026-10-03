/** Types de `fingerprint.cjs` (réglages de l'empreinte native, essais de `test/fingerprint.test.ts`). */
type HookSource = { type: 'file'; filePath: string } | { type: 'contents'; id: string };
type Chunk = Uint8Array | string | null;

declare const fingerprint: {
  sourceSkips: string[];
  ignorePaths: string[];
  fileHookTransform(source: HookSource, chunk: Chunk, isEndOfFile: boolean, encoding: string): Chunk;
  withoutCarriageReturns(chunk: Chunk): Chunk;
  isProjectTextFile(filePath: string): boolean;
  stableExpoConfig(contents: string): string;
};

export = fingerprint;
