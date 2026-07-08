export type RunMode = 'instant' | 'default' | 'manual';

export interface CropSpec {
  mode: 'face' | 'figure';
  anchorX: number;
  anchorY: number;
  subjectFraction: number;
  straighten?: boolean;
  notes?: string;
}

export interface CropMeta {
  srcW: number;
  srcH: number;
  figure: [number, number, number, number];
  centerFace: [number, number];
  centerFigure: [number, number];
  angle: number;                 // rotation baked into this crop (degrees)
  bg: [number, number, number];  // background color (rotation fill / editor backdrop)
  lowConfidence: boolean;        // detection was unsure
  cropBox: { left: number; top: number; width: number; height: number };
}

export interface ImageResult {
  id: string;
  name: string;
  pngDataUrl: string;
  meta: CropMeta;
  flagged: boolean;
}
