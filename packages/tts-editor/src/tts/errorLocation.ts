/** Where a TTS Lua error happened. Lines are 1-based, columns 0-based (MoonSharp's convention). */
export interface ErrorLocation {
  /** Script name TTS compiled the code under, e.g. `Global`, `Deck - a1b2c3`, or `executeScript`. */
  chunk: string;
  startLine: number;
  startColumn: number;
  endLine: number;
  endColumn: number;
}

/**
 * MoonSharp writes `chunk:(line,col)`, `chunk:(line,col-col)`, or `chunk:(line,col-line,col)` when the
 * failing expression spans several lines (typical for multi-line `error(...)` calls).
 */
const locationPattern = /([^\s:\]][^:\]]*?):\((\d+),(\d+)(?:-(\d+)(?:,(\d+))?)?\)/;

export const parseErrorLocation = (text: string | undefined): ErrorLocation | undefined => {
  const match = text?.match(locationPattern);
  if (!match) {
    return undefined;
  }

  const [, chunk, line, column, third, fourth] = match;
  const startLine = Number(line);
  const startColumn = Number(column);
  if (fourth !== undefined) {
    return { chunk, startLine, startColumn, endLine: Number(third), endColumn: Number(fourth) };
  }
  return { chunk, startLine, startColumn, endLine: startLine, endColumn: third !== undefined ? Number(third) : startColumn };
};

/** Code sent with Execute Lua (the editor command, MCP agents) is not stored in any file. */
export const isExecutedSnippet = (location: ErrorLocation): boolean => location.chunk === "executeScript";

const CONTEXT_LINES = 3;

const LUA_KEYWORDS =
  /\b(and|break|do|else|elseif|end|false|for|function|goto|if|in|local|nil|not|or|repeat|return|then|true|until|while)\b/g;

/** Lines such as `end`, `else`, `return true` or `})` appear everywhere and say nothing about position. */
const isGeneric = (line: string) => line.replace(LUA_KEYWORDS, "").replace(/[^A-Za-z0-9_]/g, "").length < 3;

/**
 * Finds the line in `fileLines` that holds the failing line as TTS ran it, so a file edited since
 * Save & Play still opens at the right place. Candidates are lines with the same text (ignoring
 * indentation); the one whose surrounding distinctive lines also match best wins, then the one nearest `line`.
 *
 * @param ranLines The script TTS ran (the bundled copy).
 * @param ranLine The 1-based failing line in `ranLines`.
 * @param line The 1-based line where the failing line should be in `fileLines` if the file is unchanged.
 * @returns The 1-based line in `fileLines`, or `undefined` when the line is gone, blank, or only matches
 *          generic lines (like `end`) with no matching context.
 */
export const reanchorLine = (
  ranLines: readonly string[],
  ranLine: number,
  fileLines: readonly string[],
  line: number
): number | undefined => {
  const text = (lines: readonly string[], index: number) => (lines[index - 1] ?? "").trim();
  const target = text(ranLines, ranLine);
  if (target === "") {
    return undefined;
  }

  const contextScore = (candidate: number) => {
    let score = 0;
    for (let k = -CONTEXT_LINES; k <= CONTEXT_LINES; k++) {
      const ran = text(ranLines, ranLine + k);
      if (k !== 0 && !isGeneric(ran) && ran === text(fileLines, candidate + k)) {
        score++;
      }
    }
    return score;
  };

  let best: { line: number; score: number } | undefined;
  let candidates = 0;
  for (let candidate = 1; candidate <= fileLines.length; candidate++) {
    if (text(fileLines, candidate) !== target) {
      continue;
    }
    candidates++;
    const score = contextScore(candidate);
    const nearer = best !== undefined && Math.abs(candidate - line) < Math.abs(best.line - line);
    if (!best || score > best.score || (score === best.score && nearer)) {
      best = { line: candidate, score };
    }
  }

  if (!best || (best.score === 0 && candidates > 1 && best.line !== line)) {
    return undefined;
  }
  return best.line;
};
