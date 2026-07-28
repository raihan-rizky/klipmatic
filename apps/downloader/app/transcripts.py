from __future__ import annotations

import json

import psycopg

from app.providers.transcription import TranscriptResult, cache_model
from app.storage import Storage


def serialize_transcript(result: TranscriptResult) -> bytes:
    return json.dumps(
        {
            "language": result.language,
            "text": result.text,
            "provider": result.provider,
            "model": result.model,
            "timing_precision": result.timing_precision,
            "words": [{"text": w.text, "start": w.start, "end": w.end} for w in result.words],
        },
        ensure_ascii=False,
    ).encode("utf-8")


def store_transcript(
    conn: psycopg.Connection,
    storage: Storage,
    source_id: str,
    result: TranscriptResult,
) -> str:
    model = cache_model()
    key = f"transcripts/{source_id}/{model}.json"
    storage.put_bytes(key, serialize_transcript(result), "application/json")
    conn.execute(
        """
        insert into transcripts (source_id, provider, model, language, r2_key,
                                 word_count, cost_usd)
        values (%s, %s, %s, %s, %s, %s, %s)
        on conflict (source_id, model) do nothing
        """,
        (
            source_id,
            result.provider,
            model,
            result.language,
            key,
            len(result.words),
            result.cost_usd,
        ),
    )
    conn.commit()
    return key
