/**
 * Quote any text as a Lua long string (`[==[...]==]`), picking a bracket level that does not
 * occur in the text. The leading newline is dropped by Lua, so text starting with one survives.
 */
export const luaLongString = (text: string): string => {
  let level = 0;
  while (text.includes(`]${"=".repeat(level)}]`)) {
    level += 1;
  }
  const equals = "=".repeat(level);
  return `[${equals}[\n${text}]${equals}]`;
};
