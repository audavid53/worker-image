// Minimal typing for troika-three-text (the package ships no TypeScript types).
declare module "troika-three-text" {
  import type { Color, Material, Mesh } from "three";
  export class Text extends Mesh {
    text: string;
    font: string;
    fontSize: number;
    color: string | number | Color;
    anchorX: number | "left" | "center" | "right";
    anchorY: number | "top" | "top-baseline" | "middle" | "bottom-baseline" | "bottom";
    letterSpacing: number;
    lineHeight: number | "normal";
    maxWidth: number;
    textAlign: "left" | "right" | "center" | "justify";
    fillOpacity: number;
    material: Material;
    sync(cb?: () => void): void;
    dispose(): void;
  }
}
