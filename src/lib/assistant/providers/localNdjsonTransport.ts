export function localIterableResponse(
  iterable: AsyncIterable<Uint8Array>,
  roundId: string,
  signal?: AbortSignal,
): Response {
  const iterator = iterable[Symbol.asyncIterator]();
  const encoder = new TextEncoder();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let buffered = "";
  let totalBytes = 0;
  let closed = false;
  let controller: ReadableStreamDefaultController<Uint8Array> | undefined;

  const detachIterator = () => {
    try {
      void Promise.resolve(iterator.return?.()).catch(() => undefined);
    } catch {
      // Iterator cleanup is best-effort and must never delay stream termination.
    }
  };
  const emitRecords = (records: readonly string[]) => {
    for (const record of records) {
      if (!record.trim()) continue;
      if (encoder.encode(record).byteLength > 64 * 1024) throw new Error("Una línea NDJSON supera el tamaño permitido.");
      const event = JSON.parse(record) as Record<string, unknown>;
      controller?.enqueue(encoder.encode(`${JSON.stringify({ ...event, roundId })}\n`));
    }
  };
  const push = (chunk: Uint8Array) => {
    totalBytes += chunk.byteLength;
    if (totalBytes > 2 * 1024 * 1024) throw new Error("El stream NDJSON supera el tamaño permitido.");
    buffered += decoder.decode(chunk, { stream: true });
    const records = buffered.split("\n");
    buffered = records.pop() ?? "";
    emitRecords(records);
  };
  const finish = () => {
    buffered += decoder.decode();
    emitRecords([buffered]);
    buffered = "";
  };
  const abort = () => {
    if (closed) return;
    closed = true;
    const reason = signal?.reason ?? new DOMException("Cancelled", "AbortError");
    signal?.removeEventListener("abort", abort);
    try { controller?.error(reason); } catch { /* The consumer may already have closed the stream. */ }
    detachIterator();
  };

  const body = new ReadableStream<Uint8Array>({
    start(current) {
      controller = current;
      if (signal?.aborted) abort();
      else signal?.addEventListener("abort", abort, { once: true });
    },
    async pull(current) {
      if (closed) return;
      try {
        const next = await iterator.next();
        if (signal?.aborted) return abort();
        if (next.done) {
          finish();
          closed = true;
          signal?.removeEventListener("abort", abort);
          current.close();
          return;
        }
        push(next.value);
      } catch (error) {
        if (closed) return;
        closed = true;
        signal?.removeEventListener("abort", abort);
        current.error(error);
        detachIterator();
      }
    },
    cancel() {
      if (closed) return;
      closed = true;
      signal?.removeEventListener("abort", abort);
      detachIterator();
    },
  });
  return new Response(body, { headers: { "content-type": "application/x-ndjson" } });
}
