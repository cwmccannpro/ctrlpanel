// Downsize phone images before uploading. Canvas removes camera metadata;
// only the resized image is sent for analysis, and it is never stored.
export async function prepareMealPhoto(file) {
  if (!file || !file.type.startsWith('image/')) throw new Error('Choose a meal photo.');
  if (file.size > 20 * 1024 * 1024) throw new Error('Choose a photo smaller than 20 MB.');
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error('This image format could not be opened. Try JPEG, PNG or WebP.'));
      image.src = url;
    });
    if (!img.naturalWidth || !img.naturalHeight) throw new Error('This photo could not be read.');
    const canvas = document.createElement('canvas');
    let scale = Math.min(1, 1600 / Math.max(img.naturalWidth, img.naturalHeight));
    for (let attempt = 0; attempt < 6; attempt++) {
      canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
      canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('This browser cannot prepare photos. Try another browser or log the meal manually.');
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      const dataUrl = canvas.toDataURL('image/jpeg', 0.82 - attempt * 0.04);
      const base64 = dataUrl.split(',')[1];
      if (base64.length <= 790000) return { dataUrl, base64 };
      scale *= 0.8;
    }
    throw new Error('This photo is too large to analyze. Try a smaller image.');
  } finally { URL.revokeObjectURL(url); }
}
