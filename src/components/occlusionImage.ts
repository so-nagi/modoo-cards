import type { MaskRect, OcclusionMask } from './occlusionGeometry';

export type PixelRect = { x: number; y: number; width: number; height: number };
export type ImageTransform =
  | { kind: 'rotate-clockwise' }
  | { kind: 'crop'; rect: PixelRect }
  | { kind: 'resize'; width: number; height: number };
export type ImageCropPlan = {
  rect: PixelRect;
  normalizedRect: MaskRect;
  masks: OcclusionMask[];
  removedCount: number;
  clippedCount: number;
};

// Bound the extra canvas allocation; large originals can still be explicitly reduced.
export const MAX_TRANSFORM_PIXELS = 16_777_216;
export const MAX_TRANSFORM_SIDE = 8192;
const EPSILON = 1e-10;
const clampUnit = (value: number) => Math.max(0, Math.min(1, value));

function validateDimensions(width: number, height: number): void {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1 || !Number.isSafeInteger(width * height)) {
    throw new Error('이미지 크기는 1픽셀 이상의 정수여야 합니다.');
  }
}

function validateMask(mask: MaskRect): void {
  if (![mask.x, mask.y, mask.width, mask.height].every(Number.isFinite) ||
      mask.x < -EPSILON || mask.y < -EPSILON || mask.width <= 0 || mask.height <= 0 ||
      mask.x + mask.width > 1 + EPSILON || mask.y + mask.height > 1 + EPSILON) {
    throw new Error('가리기 박스가 이미지 범위를 벗어났습니다.');
  }
}

/** Rotate normalized coordinates with the image, retaining editor IDs and groups. */
export function rotateMasksClockwise(masks: readonly OcclusionMask[]): OcclusionMask[] {
  return masks.map(mask => {
    validateMask(mask);
    return { ...mask, x: clampUnit(1 - mask.y - mask.height), y: clampUnit(mask.x), width: mask.height, height: mask.width };
  });
}

function snappedPixel(value: number): number {
  const integer = Math.round(value);
  return Math.abs(value - integer) < 1e-7 ? integer : value;
}

/** The rounded crop rectangle is shared by canvas pixels and mask remapping. */
export function planImageCrop(width: number, height: number, crop: MaskRect, masks: readonly OcclusionMask[]): ImageCropPlan {
  validateDimensions(width, height);
  if (![crop.x, crop.y, crop.width, crop.height].every(Number.isFinite) || crop.width <= 0 || crop.height <= 0) {
    throw new Error('자를 영역을 이미지 위에서 선택해 주세요.');
  }
  const left = clampUnit(crop.x), top = clampUnit(crop.y);
  const right = clampUnit(crop.x + crop.width), bottom = clampUnit(crop.y + crop.height);
  if (right <= left || bottom <= top) throw new Error('자를 영역이 이미지와 겹치지 않습니다.');
  const x = Math.floor(snappedPixel(left * width)), y = Math.floor(snappedPixel(top * height));
  const endX = Math.ceil(snappedPixel(right * width)), endY = Math.ceil(snappedPixel(bottom * height));
  const rect = { x, y, width: endX - x, height: endY - y };
  const normalizedRect = { x: x / width, y: y / height, width: rect.width / width, height: rect.height / height };
  const result: OcclusionMask[] = [];
  let removedCount = 0, clippedCount = 0;
  for (const mask of masks) {
    validateMask(mask);
    const maskLeft = Math.max(x, snappedPixel(mask.x * width)), maskTop = Math.max(y, snappedPixel(mask.y * height));
    const maskRight = Math.min(endX, snappedPixel((mask.x + mask.width) * width)), maskBottom = Math.min(endY, snappedPixel((mask.y + mask.height) * height));
    if (maskRight <= maskLeft || maskBottom <= maskTop) { removedCount++; continue; }
    if (mask.x < normalizedRect.x - EPSILON || mask.y < normalizedRect.y - EPSILON ||
        mask.x + mask.width > endX / width + EPSILON || mask.y + mask.height > endY / height + EPSILON) clippedCount++;
    const remappedX = clampUnit((maskLeft - x) / rect.width), remappedY = clampUnit((maskTop - y) / rect.height);
    result.push({ ...mask, x: remappedX, y: remappedY,
      width: Math.min(1 - remappedX, (maskRight - maskLeft) / rect.width),
      height: Math.min(1 - remappedY, (maskBottom - maskTop) / rect.height) });
  }
  return { rect, normalizedRect, masks: result, removedCount, clippedCount };
}

function validatePixelCrop(rect: PixelRect, width: number, height: number): void {
  validateDimensions(rect.width, rect.height);
  if (!Number.isSafeInteger(rect.x) || !Number.isSafeInteger(rect.y) || rect.x < 0 || rect.y < 0 ||
      rect.x + rect.width > width || rect.y + rect.height > height) {
    throw new Error('자를 영역이 이미지 범위를 벗어났습니다.');
  }
}

/** Transform a loaded image without changing its source or reducing pixels implicitly. */
export async function transformOcclusionImage(image: HTMLImageElement, transform: ImageTransform, filename = 'image'): Promise<File> {
  const sourceWidth = image.naturalWidth, sourceHeight = image.naturalHeight;
  if (!image.complete || sourceWidth < 1 || sourceHeight < 1) throw new Error('이미지를 불러온 뒤 다시 시도해 주세요.');
  validateDimensions(sourceWidth, sourceHeight);
  let width = sourceWidth, height = sourceHeight;
  if (transform.kind === 'rotate-clockwise') { width = sourceHeight; height = sourceWidth; }
  else if (transform.kind === 'crop') { validatePixelCrop(transform.rect, sourceWidth, sourceHeight); width = transform.rect.width; height = transform.rect.height; }
  else {
    validateDimensions(transform.width, transform.height);
    if (transform.width > sourceWidth || transform.height > sourceHeight) throw new Error('해상도는 원본보다 작거나 같아야 합니다.');
    width = transform.width; height = transform.height;
  }
  if (width > MAX_TRANSFORM_SIDE || height > MAX_TRANSFORM_SIDE || width * height > MAX_TRANSFORM_PIXELS) {
    throw new Error('처리할 이미지가 큽니다. 해상도를 줄이거나 더 작은 영역을 선택해 주세요.');
  }
  const canvas = document.createElement('canvas');
  try {
    canvas.width = width; canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('이 브라우저에서 이미지를 처리할 수 없습니다.');
    context.imageSmoothingEnabled = transform.kind === 'resize';
    context.imageSmoothingQuality = 'high';
    if (transform.kind === 'rotate-clockwise') {
      context.translate(width, 0); context.rotate(Math.PI / 2);
      context.drawImage(image, 0, 0, sourceWidth, sourceHeight);
    } else if (transform.kind === 'crop') {
      const rect = transform.rect;
      context.drawImage(image, rect.x, rect.y, rect.width, rect.height, 0, 0, width, height);
    } else context.drawImage(image, 0, 0, sourceWidth, sourceHeight, 0, 0, width, height);
    const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(value => {
      if (value) resolve(value); else reject(new Error('편집한 이미지를 저장하지 못했습니다. 다시 시도해 주세요.'));
    }, 'image/png'));
    const base = (filename.split(/[\\/]/).pop() || 'image').replace(/\.[^.]*$/, '').replace(/-edited$/, '') || 'image';
    return new File([blob], `${base}-edited.png`, { type: 'image/png' });
  } finally {
    canvas.width = 1; canvas.height = 1;
  }
}
