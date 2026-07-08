export interface CropSpec {
  mode: 'face' | 'figure';
  anchorX: number;
  anchorY: number;
  subjectFraction: number;
  notes?: string;
}

export interface CropMeta {
  srcW: number;
  srcH: number;
  figure: [number, number, number, number];
  centerFace: [number, number];
  centerFigure: [number, number];
  cropBox: { left: number; top: number; width: number; height: number };
}

export interface ImageResult {
  id: string;
  name: string;
  pngDataUrl: string;
  meta: CropMeta;
  flagged: boolean;
}
