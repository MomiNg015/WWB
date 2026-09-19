import raw from "./data/zh-hans.json";
import type { Item, Element, Rules } from "./types";
export const items = raw.items as Item[];
export let texts = raw.texts;
export function setCatalogLocale(data: typeof raw) {
  texts = data.texts;
  const names = new Map(data.items.map((i) => [i.imageName, i.name]));
  items.forEach((i) => {
    i.name = names.get(i.imageName) || i.name;
  });
}
export const catalog = new Map(items.map((item) => [item.imageName, item]));
export function itemById(id: string): Item {
  const item = catalog.get(id);
  if (!item) throw new Error("未知神器");
  return item;
}
export const colors: Record<Element, string> = {
  "": "#4f4f4f",
  fire: "#dd4444",
  water: "#4444dd",
  wood: "#dd9900",
  stone: "#6688bb",
  light: "#aaaa00",
  darkness: "#9944cc",
};
export const classicRules: Rules = {
  id: "classic",
  initialHP: 50,
  initialMP: 10,
  initialCP: 20,
  handSize: 9,
  maxHandSize: 18,
  maxStat: 99,
  tiebreak: 100,
  diseaseChance: 0.05,
  guardianChance: 0.25,
  guardianLeaveChance: 0.1,
  devilChance: 0.25,
};
export const imageURL = (item: Item) =>
  `/assets/images/items/${item.category}/${item.imageName}.webp`;
export function statLabel(i: Item) {
  return (
    [
      i.hitRate !== undefined ? `${i.hitRate}%` : "",
      i.atk !== undefined ? `${i.isPlusAtk ? "+" : ""}攻${i.atk}` : "",
      i.def !== undefined ? `守${i.def}` : "",
    ]
      .filter(Boolean)
      .join(" ") || abilityLabel(i)
  );
}
export function abilityLabel(i: Item) {
  let key = i.ability || "";
  if (key === "addCurse" || key === "counterCurse")
    return (texts.curseNames as Record<string, string>)[i.curse || ""] || "";
  let text = (texts.abilities as Record<string, string>)[key] || "";
  const values: Record<string, string | number> = {
    hp: i.abilityValue || 0,
    mp: i.abilityValue || 0,
    cp: i.abilityValue || 0,
    value: i.abilityValue || 0,
    damage: i.abilityValue || 0,
    element:
      (texts.elementNames as Record<string, string>)[i.element || ""] || "",
    curse: (texts.curseNames as Record<string, string>)[i.curse || ""] || "",
  };
  return text
    .replace(/\{\{(\w+)\}\}/g, (_, k) => String(values[k] ?? ""))
    .replace(/<br>/g, " ");
}
