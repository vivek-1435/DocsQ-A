import re
import time
import random
from concurrent.futures import ThreadPoolExecutor

from langchain_google_genai import GoogleGenerativeAIEmbeddings

MAX_BATCH_CHARS = 150_000
MAX_BATCH_SIZE = 100
MAX_WORKERS = 5
RETRY_COUNT = 6
REQUEST_PACING_SECONDS = 0.5


class ParallelGoogleGenerativeAIEmbeddings(GoogleGenerativeAIEmbeddings):
    def embed_documents(
        self,
        texts: list[str],
        *,
        batch_size: int = 100,
        task_type: str | None = None,
        titles: list[str] | None = None,
        output_dimensionality: int | None = None,
    ) -> list[list[float]]:
        if texts:
            chunk_len = len(texts[0])
            dynamic_batch_size = max(1, min(MAX_BATCH_SIZE, int(MAX_BATCH_CHARS / chunk_len)))
        else:
            dynamic_batch_size = MAX_BATCH_SIZE

        print(f"Dynamic batch size: first chunk length is {chunk_len if texts else 0} chars. Using batch_size={dynamic_batch_size}")
        batches = [texts[i:i + dynamic_batch_size] for i in range(0, len(texts), dynamic_batch_size)]
        
        def _embed_batch(batch_texts):
            for attempt in range(RETRY_COUNT):
                try:
                    return super(ParallelGoogleGenerativeAIEmbeddings, self).embed_documents(
                        batch_texts,
                        batch_size=len(batch_texts),
                        task_type=task_type,
                        output_dimensionality=output_dimensionality
                    )
                except Exception as e:
                    err_str = str(e)
                    is_rate_limit = (
                        getattr(e, "status_code", None) == 429
                        or "429" in err_str
                        or "RESOURCE_EXHAUSTED" in err_str
                    )
                    
                    if is_rate_limit and attempt < RETRY_COUNT - 1:
                        sleep_time = (2.5 ** attempt) + 1.0 + random.uniform(0.5, 3.5)
                        match = re.search(r"retry in ([\d\.]+)s", err_str)
                        if match:
                            sleep_time = float(match.group(1)) + 1.0 + random.uniform(0.5, 2.5)
                        print(f"\nRate limit (429) hit. Attempt {attempt + 1}/{RETRY_COUNT}. Sleeping {sleep_time:.2f}s.")
                        time.sleep(sleep_time)
                    else:
                        raise e
            
        results = []
        print(f"Embedding {len(texts)} chunks in parallel with {MAX_WORKERS} threads...")
        with ThreadPoolExecutor(max_workers=MAX_WORKERS) as executor:
            futures = []
            for batch in batches:
                futures.append(executor.submit(_embed_batch, batch))
                time.sleep(REQUEST_PACING_SECONDS)
                
            for future in futures:
                results.extend(future.result())
                
        return results
