import type { Item } from "../shared/types";
import { imageURL, colors, statLabel, abilityLabel } from "../shared/catalog";
export function Detail({ item }: { item: Item }) {
  return (
    <div className="detail">
      <img src={imageURL(item)} alt={item.name} />
      <div className="detail-title">{item.name}</div>
      <div
        className="detail-body"
        style={{ color: colors[item.element || ""] }}
      >
        <strong>{statLabel(item)}</strong>
        {item.atk !== undefined && item.def !== undefined && (
          <span> 守{item.def}</span>
        )}
        {item.atk !== undefined && item.ability && (
          <small>{abilityLabel(item)}</small>
        )}
      </div>
      {item.cost !== undefined ? (
        <div className="price cost">
          MP
          <br />
          {item.cost}
        </div>
      ) : item.price !== undefined ? (
        <div className="price">¥{item.price}</div>
      ) : null}
    </div>
  );
}
