/**
 * Visual class for the TTS Objects tree.
 *
 * Sources for `Name` values:
 * - https://api.tabletopsimulator.com/built-in-object/
 * - https://api.tabletopsimulator.com/custom-game-objects/
 * - https://kb.tabletopsimulator.com/custom-content/save-file-format/ (Object Name List)
 * - `@typed-tabletop-simulator` `ObjectName` / `ModelType`
 *
 * Custom model / assetbundle saves often use suffixed Names
 * (`Custom_Model_Infinite_Bag`, `Custom_Assetbundle_Bag`) and/or `TypeIndex`.
 */
export enum ObjectType {
  bag = "bag",
  block = "block",
  board = "board",
  bundle = "bundle",
  calculator = "calculator",
  card = "card",
  clock = "clock",
  counter = "counter",
  deck = "deck",
  die = "die",
  figure = "figure",
  notecard = "notecard",
  other = "other",
  stack = "stack",
  table = "table",
  tablet = "tablet",
  text = "text",
  tile = "tile",
  token = "token",
  zone = "zone",
}

export const getObjectType = (data: ObjectData): ObjectType => {
  const name = data.Name;

  if (name === "Custom_Model" || name?.startsWith("Custom_Model_")) {
    if (name !== "Custom_Model") {
      const fromSuffix = typeFromCustomSuffix(name.slice("Custom_Model_".length));
      if (fromSuffix) {
        return fromSuffix;
      }
    }
    const modelType = (data as ModelData).CustomMesh?.TypeIndex ?? ModelType.Generic;
    return mapModelType(modelType);
  }

  if (name === "Custom_Assetbundle" || name?.startsWith("Custom_Assetbundle_")) {
    if (name !== "Custom_Assetbundle") {
      const fromSuffix = typeFromCustomSuffix(name.slice("Custom_Assetbundle_".length));
      if (fromSuffix) {
        return fromSuffix;
      }
    }
    const modelType =
      (data as AssetBundleData).CustomAssetbundle?.TypeIndex ?? ModelType.Generic;
    return mapModelType(modelType);
  }

  return getObjectTypeForName(name);
};

/** Exported for unit checks. */
export const getObjectTypeForName = (name: string | undefined): ObjectType => {
  if (!name) {
    return ObjectType.other;
  }

  const exact = EXACT_NAMES[name];
  if (exact) {
    return exact;
  }

  // Stacks / facades before Chip* / Card* prefixes
  if (name.includes("Stack") || name.includes("Facade")) {
    return ObjectType.stack;
  }

  if (name.startsWith("rpg_") || name.startsWith("Figurine")) {
    return ObjectType.figure;
  }

  if (name.startsWith("Chess_")) {
    return ObjectType.figure;
  }

  if (name.startsWith("Checker_") || name.startsWith("Chinese_Checkers_Piece")) {
    return ObjectType.token;
  }

  if (name.startsWith("Chip_")) {
    return ObjectType.token;
  }

  if (name.startsWith("PiecePack_") || name.startsWith("go_game_piece")) {
    return ObjectType.token;
  }

  if (name.startsWith("go_game_bowl")) {
    return ObjectType.bag;
  }

  if (name.startsWith("backgammon_piece")) {
    return ObjectType.token;
  }

  if (name.startsWith("Die_") || name === "Custom_Dice" || /Dice/i.test(name)) {
    return ObjectType.die;
  }

  if (name.startsWith("Deck") || name === "DeckCustom") {
    return ObjectType.deck;
  }

  if (name.startsWith("Card") || name === "CardCustom") {
    return ObjectType.card;
  }

  if (name.startsWith("Block")) {
    return ObjectType.block;
  }

  if (name.startsWith("Tileset_") || name === "Custom_Tile" || name.includes("Tile")) {
    return ObjectType.tile;
  }

  if (name === "Custom_Token" || name.startsWith("Custom_Token") || name.includes("Token")) {
    return ObjectType.token;
  }

  if (name.includes("Board") || name.endsWith("_board") || name === "Custom_Board") {
    return ObjectType.board;
  }

  if (name.startsWith("Table_")) {
    return ObjectType.table;
  }

  if (
    name.includes("Infinite_Bag") ||
    name === "Bag" ||
    name.endsWith("_Bag") ||
    name.includes("Bag")
  ) {
    return ObjectType.bag;
  }

  if (
    name.includes("Fog") ||
    name.includes("Trigger") ||
    name.includes("Zone") ||
    name === "HandTrigger" ||
    name === "LayoutZone" ||
    name === "ScriptingTrigger" ||
    name === "RandomizeTrigger"
  ) {
    return ObjectType.zone;
  }

  if (name.startsWith("Sky_")) {
    return ObjectType.other;
  }

  return ObjectType.other;
};

const EXACT_NAMES: Readonly<Record<string, ObjectType>> = {
  Calculator: ObjectType.calculator,
  Counter: ObjectType.counter,
  Digital_Clock: ObjectType.clock,
  Notecard: ObjectType.notecard,
  Tablet: ObjectType.tablet,
  "3DText": ObjectType.text,
  LineObject: ObjectType.text,

  Quarter: ObjectType.token,
  Ball: ObjectType.token,
  "Metal Ball": ObjectType.token,
  PlayerPawn: ObjectType.figure,
  Domino: ObjectType.tile,
  Mahjong_Coin: ObjectType.token,
  Mahjong_Stick: ObjectType.token,
  Mahjong_Tile: ObjectType.tile,
  reversi_chip: ObjectType.token,
  Cup: ObjectType.other,
  Bowl: ObjectType.other,

  Custom_Model: ObjectType.bundle,
  Custom_Assetbundle: ObjectType.bundle,
  Custom_Board: ObjectType.board,
  Custom_Dice: ObjectType.die,
  Custom_Tile: ObjectType.tile,
  Custom_Token: ObjectType.token,
  CardCustom: ObjectType.card,
  DeckCustom: ObjectType.deck,
  Figurine_Custom: ObjectType.figure,

  Bag: ObjectType.bag,
  Infinite_Bag: ObjectType.bag,
  Custom_Model_Bag: ObjectType.bag,
  Custom_Model_Infinite_Bag: ObjectType.bag,
  Custom_Assetbundle_Bag: ObjectType.bag,
  Custom_Assetbundle_Infinite_Bag: ObjectType.bag,

  FogOfWar: ObjectType.zone,
  FogOfWarTrigger: ObjectType.zone,
  HandTrigger: ObjectType.zone,
  LayoutZone: ObjectType.zone,
  RandomizeTrigger: ObjectType.zone,
  ScriptingTrigger: ObjectType.zone,
  MarqueeTrigger: ObjectType.zone,
  SearchTriggerObject: ObjectType.zone,
  SearchSpaceHolder: ObjectType.zone,
};

const typeFromCustomSuffix = (suffix: string): ObjectType | undefined => {
  switch (suffix) {
    case "Bag":
    case "Infinite_Bag":
      return ObjectType.bag;
    case "Dice":
      return ObjectType.die;
    case "Figurine":
      return ObjectType.figure;
    case "Board":
      return ObjectType.board;
    case "Coin":
    case "Chip":
      return ObjectType.token;
    default:
      return undefined;
  }
};

const mapModelType = (modelType: ModelType): ObjectType => {
  switch (modelType) {
    case ModelType.Bag:
    case ModelType.Infinite:
      return ObjectType.bag;
    case ModelType.Dice:
      return ObjectType.die;
    case ModelType.Figurine:
      return ObjectType.figure;
    case ModelType.Board:
      return ObjectType.board;
    case ModelType.Coin:
    case ModelType.Chip:
      return ObjectType.token;
    case ModelType.Generic:
    default:
      return ObjectType.bundle;
  }
};
