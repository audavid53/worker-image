import { FilmSlate } from "@phosphor-icons/react";
import type { Shot } from "../../../shared/shots";
import { useProject } from "../../data/project";
import { snapshot } from "../../three/primitives";

/**
 * Until shots are rendered (milestone 7), a shot's thumbnail is the Casting asset of its first
 * cast member, else its location.
 */
export function ShotThumb({ shot }: { shot: Shot }) {
  const { assets, activeAsset } = useProject().state;
  const owners = [...shot.castIds, ...(shot.locationId ? [shot.locationId] : [])];
  for (const owner of owners) {
    const mine = assets.filter((a) => a.ownerId === owner);
    const a = mine.find((x) => x.id === activeAsset[owner]) ?? mine.at(-1);
    if (a?.kind === "image" && a.url) return <img className="shot-thumb" src={a.url} alt="" />;
    if (a?.kind === "code3d" && a.spec) {
      const src = snapshot(a.id, a.spec);
      if (src) return <img className="shot-thumb shot-thumb--3d" src={src} alt="" />;
    }
  }
  return (
    <span className="shot-thumb shot-thumb--empty" aria-hidden>
      <FilmSlate size={16} />
      {shot.size}
    </span>
  );
}
