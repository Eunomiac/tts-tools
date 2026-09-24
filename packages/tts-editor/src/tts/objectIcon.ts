import { ThemeIcon, Uri } from "vscode";

import { iconPath } from "../io/files";
import { ObjectType } from "./objectType";

/** Types that ship as light/dark PNGs under `media/icon/`. */
const PNG_OBJECT_TYPES = new Set<ObjectType>([
  ObjectType.bag,
  ObjectType.block,
  ObjectType.board,
  ObjectType.card,
  ObjectType.deck,
  ObjectType.die,
  ObjectType.figure,
  ObjectType.tile,
  ObjectType.token,
]);

/**
 * Codicon ids for types without custom PNGs.
 * @see https://code.visualstudio.com/api/references/icons-in-labels
 */
const THEME_ICONS: Readonly<Partial<Record<ObjectType, string>>> = {
  [ObjectType.bundle]: "package",
  [ObjectType.calculator]: "symbol-operator",
  [ObjectType.clock]: "clock",
  [ObjectType.counter]: "number",
  [ObjectType.notecard]: "note",
  [ObjectType.other]: "symbol-misc",
  [ObjectType.stack]: "layers",
  [ObjectType.table]: "window",
  [ObjectType.tablet]: "device-mobile",
  [ObjectType.text]: "symbol-text",
  [ObjectType.zone]: "bounding-box",
};

export const objectTypeIcon = (
  type: ObjectType
): ThemeIcon | { light: Uri; dark: Uri } => {
  if (PNG_OBJECT_TYPES.has(type)) {
    return iconPath(type);
  }
  return new ThemeIcon(THEME_ICONS[type] ?? "symbol-misc");
};
