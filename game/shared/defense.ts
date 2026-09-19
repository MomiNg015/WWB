import { itemById } from "./catalog";
import { actionCost } from "./actions";
import type { Action, Card, Element, Item } from "./types";

export function canDefend(attack: Element, defense: Element): boolean {
  if (attack === "light") return false;
  if (attack === "" || attack === "darkness") return true;
  return (
    defense === "light" ||
    (
      { fire: "water", water: "fire", wood: "stone", stone: "wood" } as Record<
        string,
        string
      >
    )[attack] === defense
  );
}
export function defenseSpecial(a: Action, d: Item, filtered: boolean) {
  const ability = d.ability || "";
  if (ability === "reflectAnything") return true;
  if (a.miracle)
    return ["bounceMiracle", "reflectMiracle", "blockMiracle"].includes(
      ability,
    );
  return (
    a.kind === "attack" &&
    (a.cards[0]?.category === "weapons" ||
      a.cards[0]?.ability === "categoryWeapons") &&
    (filtered || a.element === "") &&
    ["bounceWeapon", "reflectWeapon", "blockWeapon"].includes(ability)
  );
}
export function defenseError(
  a: Action,
  cards: Card[],
  mp: number,
  curses: string[],
): string | null {
  if (a.kind === "purchase") return "请选择购买或放弃购买";
  if (new Set(cards.map((c) => c.uid)).size !== cards.length)
    return "不能重复选择";
  if (curses.includes("flash") && cards.length > 1)
    return "闪光状态只能使用一件神器";
  const defs = cards.map((c) => itemById(c.id));
  const filter = defs.some((d) => d.ability === "filterAtkElement");
  const element = filter ? "" : a.element;
  if (actionCost(defs) > mp) return "MP不足";
  for (const [n, d] of defs.entries()) {
    if (n > 0 && defs[n - 1].category === "miracles" && d.ability === "cutCost")
      continue;
    if (defenseSpecial(a, d, filter)) {
      if (n === 0 || defs[n - 1].ability === "filterAtkElement") continue;
      return "反射、乱弹或防止不能与普通防具叠加";
    }
    if (defs.slice(0, n).some((other) => defenseSpecial(a, other, filter)))
      return "特殊防御后不能追加普通防具";
    if (a.kind !== "attack") return "不能响应这类行动";
    if (d.ability === "filterAtkElement") {
      if (n === 0 || defs[n - 1].ability === "filterAtkElement") continue;
      return "清除属性必须先于其他防御神器";
    }
    // A counter effect does not bypass the card's elemental restriction.
    if (
      (d.def !== undefined || (d.ability || "").startsWith("counter")) &&
      canDefend(element, d.element || "")
    )
      continue;
    return "不能防御当前属性";
  }
  return null;
}
