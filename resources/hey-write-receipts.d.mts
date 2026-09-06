export function beginHeyWrite(directory: string | undefined, command: string[]): string | undefined;
export function completeHeyWrite(file: string | undefined): void;
export function pendingHeyWrites(directory: string): string[];
export function acknowledgeHeyWrites(directory: string): void;
export function isMailWrite(args: string[]): boolean;
