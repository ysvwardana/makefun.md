export interface EnhancementLogEntry {
  timestamp: string;
  message: string;
}

export async function readEnhancementStream<T>(response: Response, onProgress: (entry: EnhancementLogEntry) => void) {
  if (!response.body) throw new Error('Server tidak mengirim log analisis.');
  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
  let pending = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) throw new Error('Koneksi log terputus sebelum hasil analisis diterima.');
      pending += value;
      let end = pending.indexOf('\n');
      while (end !== -1) {
        const event = JSON.parse(pending.slice(0, end));
        pending = pending.slice(end + 1);
        if (event.type === 'result') return { status: event.status as number, data: event.data as T };
        if (event.type === 'progress') onProgress({ timestamp: event.timestamp, message: event.message });
        end = pending.indexOf('\n');
      }
    }
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}
