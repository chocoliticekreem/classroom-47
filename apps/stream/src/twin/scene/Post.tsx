"use client";

import {
  Bloom,
  BrightnessContrast,
  EffectComposer,
  HueSaturation,
  ToneMapping,
  Vignette,
} from "@react-three/postprocessing";
import { useFrame } from "@react-three/fiber";
import { ToneMappingMode, type BloomEffect, type BrightnessContrastEffect, type HueSaturationEffect } from "postprocessing";
import { useRef } from "react";
import { ATMOS } from "./palette";

export function Post() {
  const bloom = useRef<BloomEffect>(null);
  const grade = useRef<BrightnessContrastEffect>(null);
  const saturation = useRef<HueSaturationEffect>(null);

  useFrame(() => {
    if (bloom.current) bloom.current.intensity = ATMOS.bloom;
    if (grade.current) grade.current.brightness = ATMOS.brightness;
    if (saturation.current) saturation.current.saturation = ATMOS.saturation;
  });

  return (
    <EffectComposer multisampling={4}>
      <Bloom ref={bloom} mipmapBlur intensity={1.1} luminanceThreshold={1} luminanceSmoothing={0.25} />
      <ToneMapping mode={ToneMappingMode.ACES_FILMIC} />
      <HueSaturation ref={saturation} saturation={0.1} />
      <BrightnessContrast ref={grade} contrast={0.1} brightness={0.035} />
      <Vignette eskil={false} offset={0.2} darkness={0.5} />
    </EffectComposer>
  );
}
