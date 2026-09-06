export class HeyAccountScope {
  constructor(accountId: string, server: string);
  prepare(args: string[], read: (args: string[]) => Promise<{ stdout: string }>): Promise<string[]>;
  learn(args: string[], stdout: string): void;
}
