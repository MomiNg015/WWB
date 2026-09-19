import type { Element, Item } from "./types";

// Independent equivalents of the public client's tw / l9 / la / ev helpers.
export function actionCost(cards: Item[]): number {
  return cards.reduce(
    (sum, d, n) =>
      sum +
      (d.category === "miracles" && cards[n + 1]?.ability !== "cutCost"
        ? d.cost || 0
        : 0),
    0,
  );
}
export function mixElement(a: Element, b: Element): Element {
  if (a === b) return a;
  if (!a || !b || a === "darkness" || b === "darkness") return "";
  if (a === "light") return b;
  if (b === "light") return a;
  return "";
}
export function attackProfile(cards: Item[], mp: number) {
  const first = cards[0];
  let atk = first?.ability === "atkBy2xMP" ? mp * 2 : first?.atk || 0;
  let element: Element = first?.element || "";
  for (const d of cards.slice(1)) {
    if (d.ability === "cutCost") continue;
    atk = d.ability === "doubleAtk" ? atk * 2 : atk + (d.atk || 0);
    element =
      d.ability === "filterAtkElement"
        ? ""
        : d.ability === "setElement"
          ? d.element || ""
          : mixElement(element, d.element || "");
  }
  return { atk, element };
}
export function attackSelectionError(
  cards: Item[],
  mp = Infinity,
): string | null {
  if (!cards.length) return "请选择神器";
  const first = cards[0];
  const specialDefense = [
    "bounceWeapon",
    "reflectWeapon",
    "blockWeapon",
    "bounceMiracle",
    "reflectMiracle",
    "blockMiracle",
    "reflectAnything",
  ];
  const primary =
    first.category === "weapons" ||
    first.category === "trade" ||
    (first.category === "sundries" &&
      !first.isPlusAtk &&
      !["cutCost", "revive", "attractDanger"].includes(first.ability || "")) ||
    (first.category === "miracles" &&
      !(first.isPlusAtk && !first.atk) &&
      !specialDefense.includes(first.ability || ""));
  if (!primary) return "这件神器不能作为主动行动的第一张";
  for (let n = 1; n < cards.length; n++) {
    const d = cards[n];
    if (cards[n - 1].category === "miracles" && d.ability === "cutCost")
      continue;
    if (d.isPlusAtk && first.category === "weapons" && !first.hitRate) continue;
    return "不能按此顺序组合神器";
  }
  if (actionCost(cards) > mp) return "MP不足";
  return null;
}
