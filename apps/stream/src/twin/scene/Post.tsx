"use client";

import {
  Bloom,
  BrightnessContrast,
  EffectComposer,
  HueSaturation,
  ToneMapping,
  Vignette,
} from "@react-three/postprocessing";
import { ToneMappingMode } from "postprocessing";

export function Post() {
  return (
    <EffectComposer multisampling={0}>
      <Bloom mipmapBlur intensity={1.1} luminanceThreshold={1} luminanceSmoothing={0.25} />
      <ToneMapping mode={ToneMappingMode.ACES_FILMIC} />
      <HueSaturation saturation={0.1} />
      <BrightnessContrast contrast={0.1} brightness={0.035} />
      <Vignette eskil={false} offset={0.2} darkness={0.5} />
    </EffectComposer>
  );
}
