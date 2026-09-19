import original from "../shared/data/zh-hans.json";
import { setCatalogLocale } from "../shared/catalog";
function flatten(
  value: unknown,
  prefix = "",
  out: Record<string, string> = {},
) {
  if (value && typeof value === "object")
    for (const [key, v] of Object.entries(value)) {
      const path = prefix ? prefix + "." + key : key;
      if (typeof v === "string") out[path] = v;
      else flatten(v, path, out);
    }
  return out;
}
const baseline = flatten(original.texts);
let dictionary = new Map<string, string>();
let generation = 0;
export async function loadLanguage(language: string) {
  const current = ++generation;
  const response = await fetch(`/i18n/${language}.json`);
  if (!response.ok) throw new Error("语言文件加载失败");
  const data = await response.json();
  if (current !== generation) return;
  const translated = flatten(data.texts);
  dictionary = new Map(
    Object.entries(baseline).map(([key, source]) => [
      source,
      translated[key] || source,
    ]),
  );
  setCatalogLocale(data);
  document.documentElement.lang = language;
}
export function t(
  source: string,
  variables: Record<string, string | number> = {},
) {
  return (dictionary.get(source) || source).replace(
    /\{\{(\w+)\}\}/g,
    (_, key) => String(variables[key] ?? ""),
  );
}
