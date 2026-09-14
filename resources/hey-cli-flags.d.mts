export declare const BOOLEAN_FLAGS: ReadonlySet<string>;
export declare const VALUE_FLAGS: ReadonlySet<string>;
export declare function parseHeyArgs(args: string[]): {
  positionals: string[];
  options: { name: string; value: string; optionIndex: number; valueIndex: number; inline: boolean; boolean: boolean }[];
  values(flag: string): string[];
  has(flag: string): boolean;
};
