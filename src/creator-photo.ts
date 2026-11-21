export async function creatorJpeg(file: File): Promise<Blob> {
  if (!file.type.startsWith('image/') || file.size > 15 * 1024 * 1024) throw new Error('Invalid photo');
  const picture = new Image();
  picture.src = await photoDataUrl(file);
  await picture.decode();
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d');
  if (!context || !picture.naturalWidth || !picture.naturalHeight) throw new Error('Invalid photo');
  for (const width of [900, 650, 450, 300]) {
    const scale = Math.min(1, width / Math.max(picture.naturalWidth, picture.naturalHeight));
    canvas.width = Math.max(1, Math.round(picture.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(picture.naturalHeight * scale));
    context.fillStyle = '#fff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(picture, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.82));
    if (blob && blob.size <= 195000) return blob;
  }
  throw new Error('Photo is too large');
}

export function photoDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') resolve(reader.result);
      else reject(new Error('Invalid photo'));
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}
