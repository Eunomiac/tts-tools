/**
 * Smoke checks for TTS Objects Name → icon class mapping (no vscode import).
 * Run from packages/tts-editor after `npm run compile`:
 *   node --experimental-vm-modules -e "require('./dist/tts/objectType.js')"  (use this file instead)
 *
 * Prefer: npm run compile && node scripts/smoke-object-type.js
 */
/* eslint-disable @typescript-eslint/no-require-imports */
const { ObjectType, getObjectTypeForName, getObjectType } = require("../dist/tts/objectType");

// ModelType is a const enum inlined by tsc — use numeric values from TTS API.
const ModelType = { Generic: 0, Figurine: 1, Dice: 2, Coin: 3, Board: 4, Chip: 5, Bag: 6, Infinite: 7 };

const assertEq = (actual, expected, label) => {
  if (actual !== expected) {
    throw new Error(`${label}: expected ${expected}, got ${actual}`);
  }
};

const cases = [
  ["Custom_Model_Infinite_Bag", ObjectType.bag],
  ["Custom_Model_Bag", ObjectType.bag],
  ["Custom_Assetbundle_Bag", ObjectType.bag],
  ["Custom_Assetbundle", ObjectType.bundle],
  ["Custom_Model", ObjectType.bundle],
  ["Custom_Tile", ObjectType.tile],
  ["Custom_Token", ObjectType.token],
  ["Custom_Dice", ObjectType.die],
  ["Custom_Board", ObjectType.board],
  ["CardCustom", ObjectType.card],
  ["DeckCustom", ObjectType.deck],
  ["Figurine_Custom", ObjectType.figure],
  ["rpg_KNIGHT", ObjectType.figure],
  ["rpg_WEREWOLF", ObjectType.figure],
  ["PlayerPawn", ObjectType.figure],
  ["Chess_King", ObjectType.figure],
  ["Checker_red", ObjectType.token],
  ["Chip_100", ObjectType.token],
  ["ChipStack", ObjectType.stack],
  ["Die_20", ObjectType.die],
  ["Deck", ObjectType.deck],
  ["Card", ObjectType.card],
  ["Bag", ObjectType.bag],
  ["Infinite_Bag", ObjectType.bag],
  ["Tileset_Floor", ObjectType.tile],
  ["ScriptingTrigger", ObjectType.zone],
  ["FogOfWarTrigger", ObjectType.zone],
  ["HandTrigger", ObjectType.zone],
  ["Digital_Clock", ObjectType.clock],
  ["Tablet", ObjectType.tablet],
  ["Notecard", ObjectType.notecard],
  ["Calculator", ObjectType.calculator],
  ["Counter", ObjectType.counter],
  ["3DText", ObjectType.text],
  ["Table_Poker", ObjectType.table],
  ["Quarter", ObjectType.token],
  ["Domino", ObjectType.tile],
  ["SomethingBrandNew", ObjectType.other],
];

for (const [name, expected] of cases) {
  assertEq(getObjectTypeForName(name), expected, name);
}

assertEq(
  getObjectType({ Name: "Custom_Model", CustomMesh: { TypeIndex: ModelType.Dice } }),
  ObjectType.die,
  "Custom_Model TypeIndex Dice"
);
assertEq(
  getObjectType({
    Name: "Custom_Assetbundle",
    CustomAssetbundle: { TypeIndex: ModelType.Figurine },
  }),
  ObjectType.figure,
  "Custom_Assetbundle TypeIndex Figurine"
);
assertEq(
  getObjectType({ Name: "Custom_Model_Infinite_Bag" }),
  ObjectType.bag,
  "suffixed infinite bag"
);

console.log(`objectType smoke: ${cases.length + 3} checks OK`);
