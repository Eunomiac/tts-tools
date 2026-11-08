import { unbundle as unbundleXml } from "@tts-tools/xmlbundle";
import { cloneDeepWith } from "lodash";
import { unbundleString } from "luabundle";

import { SaveFile, TTSObject } from "./model/tts";

/**
 * Takes a TTS save file and unbundles it.
 *
 * @param saveFile The save to unbundle
 * @returns A copy of the given save file where all Lua and XML scripts are unbundled.
 */
export const unbundleSave = (saveFile: SaveFile): SaveFile => {
  return cloneDeepWith(saveFile, unbundler);
};

export const unbundleObject = (object: TTSObject): TTSObject => {
  return cloneDeepWith(object, unbundler);
};

const unbundler = (value: any, key: string | number | undefined, obj: any) => {
  if (key === "LuaScript") {
    return unbundleLuaScript(obj);
  } else if (key == "XmlUI" && value) {
    return xmlUnbundle(value);
  }

  return undefined;
};

const SYNTHETIC_BUNDLE_METADATA = '-- Bundled by luabundle {"version":"1.7.0"}\n';

/**
 * luabundle refuses to unbundle when the metadata comment is missing.
 * A bundle emitted with `metadata: false` still starts with the runtime; give it the default header.
 * Do not treat a script that merely contains those words inside a string as a bundle.
 */
const bundleSourceForUnbundle = (script: string): string | undefined => {
  const trimmed = script.trimStart();
  if (trimmed.startsWith("-- Bundled by luabundle")) {
    return trimmed.replace(/(-- Bundled by luabundle {[^}]+})\s*\n/, "$1\n");
  }
  if (trimmed.startsWith("local __bundle_require")) {
    return `${SYNTHETIC_BUNDLE_METADATA}${trimmed}`;
  }
  return undefined;
};

const unbundleLuaScript = (object: TTSObject) => {
  if (object.LuaScript) {
    try {
      const bundled = bundleSourceForUnbundle(object.LuaScript);
      if (!bundled) {
        return object.LuaScript;
      }

      const unbundled = unbundleString(bundled, { rootOnly: true });
      const root = unbundled.modules[unbundled.metadata.rootModuleName]?.content;
      if (typeof root !== "string") {
        throw new Error("bundled script has no root module content");
      }
      return root;
    } catch (e) {
      console.error(`Error during extracting script for object ${object.Nickname}-${object.GUID}`, e);
    }
  }

  return "";
};

/**
 * Unbundles the bundled XML `xmlUI` by removing all included files and replacing them with the `<Include src="" />` directive again.
 *
 * @param xmlUi The script content.
 * @returns The unbundled script.
 */
const xmlUnbundle = (xmlUi: string): string => {
  return unbundleXml(xmlUi).root;
};
