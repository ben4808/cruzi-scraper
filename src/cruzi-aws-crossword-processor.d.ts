declare module 'cruzi-aws/dist/crosswordProcessor.js' {
  export function processCrosswordPuzzle(
    puzzleId: string,
    provider?: unknown,
    parallelRequests?: number,
  ): Promise<boolean>;
}

declare module 'cruzi-aws/dist/ai/muse.js' {
  export class MuseAiProvider {
    sourceAI: string;
    constructor(
      sourceAi?: 'muse-ember',
      reasoningEffort?: 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max',
    );
  }
}
