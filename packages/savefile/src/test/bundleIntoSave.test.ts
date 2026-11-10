import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { describe, expect, it } from "vitest";

import {
  applyScriptsToSave,
  bundleIntoSaveFiles,
  bundleScriptsFromObjectsDir,
  guidFromObjectFileName,
} from "../main/bundleIntoSave";
import { SaveFile } from "../main/model/tts";

describe("guidFromObjectFileName", () => {
  it("maps Global and Name.guid files", () => {
    expect(guidFromObjectFileName("Global.lua")).toBe("-1");
    expect(guidFromObjectFileName("Dice Bag.abc123.lua")).toBe("abc123");
    expect(guidFromObjectFileName("readme.txt")).toBeUndefined();
  });
});

describe("applyScriptsToSave", () => {
  const baseSave = (): SaveFile => ({
    SaveName: "Test",
    LuaScript: "old global",
    XmlUI: "old global ui",
    ObjectStates: [
      {
        GUID: "top1",
        Name: "Bag",
        Nickname: "",
        Description: "",
        GMNotes: "",
        Transform: {} as any,
        LuaScript: "old top",
        ContainedObjects: [
          {
            GUID: "nested1",
            Name: "Inside",
            Nickname: "",
            Description: "",
            GMNotes: "",
            Transform: {} as any,
            LuaScript: "old nested",
          },
        ],
      },
    ],
  });

  it("updates nested ContainedObjects by GUID", () => {
    const scripts = new Map([
      ["-1", { script: "new global", ui: "<Ui/>" }],
      ["top1", { script: "new top" }],
      ["nested1", { script: "new nested" }],
    ]);
    const { stats, save } = applyScriptsToSave(baseSave(), scripts);
    expect(stats.updated).toBe(3);
    expect(save.LuaScript).toBe("new global");
    expect(save.XmlUI).toBe("<Ui/>");
    expect(save.ObjectStates[0].LuaScript).toBe("new top");
    expect(save.ObjectStates[0].ContainedObjects?.[0].LuaScript).toBe("new nested");
  });

  it("preserves Global when asked", () => {
    const scripts = new Map([
      ["-1", { script: "new global" }],
      ["top1", { script: "new top" }],
    ]);
    const { stats, save } = applyScriptsToSave(baseSave(), scripts, { preserveGlobal: true });
    expect(stats.skippedGlobal).toBe(1);
    expect(stats.updated).toBe(1);
    expect(save.LuaScript).toBe("old global");
    expect(save.ObjectStates[0].LuaScript).toBe("new top");
  });
});

describe("bundleIntoSaveFiles", () => {
  it("bundles stubs into multiple saves with preserveGlobal", () => {
    const root = mkdtempSync(join(tmpdir(), "bundle-into-save-"));
    const objectsDir = join(root, "objects");
    const includeDir = join(root, "src");
    mkdirSync(objectsDir);
    mkdirSync(includeDir);
    writeFileSync(join(includeDir, "mod.lua"), "return 42\n");
    writeFileSync(join(objectsDir, "Global.lua"), 'require("mod")\n');
    writeFileSync(join(objectsDir, "Thing.aa11.lua"), 'print("thing")\n');

    const saveA = join(root, "a.json");
    const saveB = join(root, "b.json");
    const skeleton: SaveFile = {
      SaveName: "A",
      LuaScript: "KEEP",
      ObjectStates: [
        {
          GUID: "aa11",
          Name: "Thing",
          Nickname: "",
          Description: "",
          GMNotes: "",
          Transform: {} as any,
          LuaScript: "old",
        },
      ],
    };
    writeFileSync(saveA, JSON.stringify(skeleton));
    writeFileSync(saveB, JSON.stringify({ ...skeleton, SaveName: "B", LuaScript: "SESSION" }));

    const result = bundleIntoSaveFiles({
      objectsDir,
      includePaths: [includeDir],
      targets: [
        { path: saveA, backup: false },
        { path: saveB, backup: false, preserveGlobal: true },
      ],
    });

    expect(result.scriptsBundled).toBe(2);
    const a = JSON.parse(readFileSync(saveA, "utf8")) as SaveFile;
    const b = JSON.parse(readFileSync(saveB, "utf8")) as SaveFile;
    expect(a.LuaScript).toContain("__bundle_require");
    expect(b.LuaScript).toBe("SESSION");
    expect(a.ObjectStates[0].LuaScript).toContain("thing");
    expect(b.ObjectStates[0].LuaScript).toContain("thing");
  });

  it("indexes object stubs by GUID", () => {
    const root = mkdtempSync(join(tmpdir(), "bundle-objects-"));
    const objectsDir = join(root, "objects");
    mkdirSync(objectsDir);
    writeFileSync(join(objectsDir, "Global.lua"), "print(1)\n");
    writeFileSync(join(objectsDir, "Bag.zz99.lua"), "print(2)\n");
    const scripts = bundleScriptsFromObjectsDir({ objectsDir, includePaths: [root] });
    expect([...scripts.keys()].sort()).toEqual(["-1", "zz99"]);
  });
});
