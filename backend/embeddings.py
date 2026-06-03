import logging
import random
import re
import time
from concurrent.futures import ThreadPoolExecutor

from langchain_google_genai import GoogleGenerativeAIEmbeddings

log = logging.getLogger(__name__)

MAX_BATCH_CHARS = 150_000
MAX_BATCH_SIZE  = 100
WORKERS         = 5
MAX_RETRIES     = 6
PACING_SECONDS  = 0.5


class ParallelEmbeddings(GoogleGenerativeAIEmbeddings):
    def embed_documents(self, texts: list[str], *, batch_size=100,
                        task_type=None, titles=None, output_dimensionality=None) -> list[list[float]]:
        chunk_size = max(1, min(MAX_BATCH_SIZE, int(MAX_BATCH_CHARS / len(texts[0])))) if texts else MAX_BATCH_SIZE
        batches = [texts[i:i + chunk_size] for i in range(0, len(texts), chunk_size)]
        log.info("Embedding %d texts across %d batches (%d workers).", len(texts), len(batches), WORKERS)

        def embed_batch(batch):
            for attempt in range(MAX_RETRIES):
                try:
                    return super(ParallelEmbeddings, self).embed_documents(
                        batch, batch_size=len(batch),
                        task_type=task_type, output_dimensionality=output_dimensionality,
                    )
                except Exception as err:
                    msg = str(err)
                    rate_limited = getattr(err, "status_code", None) == 429 or "429" in msg or "RESOURCE_EXHAUSTED" in msg
                    if rate_limited and attempt < MAX_RETRIES - 1:
                        wait = (2.5 ** attempt) + 1.0 + random.uniform(0.5, 3.5)
                        found = re.search(r"retry in ([\d\.]+)s", msg)
                        if found:
                            wait = float(found.group(1)) + 1.0 + random.uniform(0.5, 2.5)
                        log.warning("Rate limited — attempt %d/%d, sleeping %.1fs.", attempt + 1, MAX_RETRIES, wait)
                        time.sleep(wait)
                    else:
                        raise

        results = []
        with ThreadPoolExecutor(max_workers=WORKERS) as pool:
            futures = []
            for batch in batches:
                futures.append(pool.submit(embed_batch, batch))
                time.sleep(PACING_SECONDS)
            for future in futures:
                results.extend(future.result())
        return results
