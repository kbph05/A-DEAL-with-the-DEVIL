// Types for the generated bundle devil.mjs (`npm run build:api`): server/devil-core.ts's `handleDeal`. Self-contained on
// purpose, so that compiling api/ (Vercel does it with api/tsconfig.json) never reaches into server/ or src/.
export interface DealResult { status: number; json: unknown }
export type DevilEnv = Record<string, string | undefined>;
export declare function handleDeal(body: unknown, env: DevilEnv, log?: (line: string) => void): Promise<DealResult>;
