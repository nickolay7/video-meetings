/** Форматирование размера файла в человекочитаемый вид: 1536 → «1.5 КБ». */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 Б';

  const units = ['Б', 'КБ', 'МБ', 'ГБ'];
  const k = 1024;
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(k)), units.length - 1);
  const value = bytes / Math.pow(k, index);

  return `${value >= 10 || index === 0 ? Math.round(value) : value.toFixed(1)} ${units[index]}`;
}

/** Короткая человекочитаемая метка для MIME-типа файла, напр. «PDF», «PNG». */
export function formatFileType(mimeType: string): string {
  const known: Record<string, string> = {
    'application/pdf': 'PDF',
    'application/msword': 'DOC',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'DOCX',
    'application/vnd.ms-excel': 'XLS',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'XLSX',
    'application/vnd.ms-powerpoint': 'PPT',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'PPTX',
    'application/zip': 'ZIP',
    'application/json': 'JSON',
    'text/plain': 'TXT',
    'text/markdown': 'MD',
    'text/csv': 'CSV',
    'image/png': 'PNG',
    'image/jpeg': 'JPG',
    'image/gif': 'GIF',
    'image/svg+xml': 'SVG',
    'image/webp': 'WEBP',
    'video/mp4': 'MP4',
  };

  return known[mimeType] ?? mimeType.split('/').pop()?.toUpperCase() ?? 'FILE';
}

/** Дата загрузки файла в коротком виде: «4 авг, 14:05». */
export function formatFileDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';

  return date.toLocaleDateString('ru-RU', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}
