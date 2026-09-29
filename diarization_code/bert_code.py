import os
import configparser
import json
import time
from datetime import datetime, timezone

import torch
import torch.nn.functional as F
from transformers import AutoTokenizer, AutoModel, logging

logging.set_verbosity_error()


# ============================================================
# CONFIG
# ============================================================

config = configparser.ConfigParser()

config.read(
    os.path.join(
        os.path.dirname(__file__),
        "config.ini"
    )
)


# ============================================================
# DEVICE
# ============================================================

device = torch.device(
    "cuda:0"
    if torch.cuda.is_available()
    else "cpu"
)

if torch.cuda.is_available():

    torch.cuda.set_device(device)

    memory_fraction = config.getfloat(
        "PROCESS_MODE",
        "memory_fraction",
        fallback=1.0
    )

    torch.cuda.set_per_process_memory_fraction(
        memory_fraction,
        device=device
    )

    print(
        f"GPU available: {device}. "
        f"Setting memory fraction to "
        f"{memory_fraction * 100}%"
    )


# ============================================================
# LOAD BERT MODEL
# ============================================================

print(
    f"Loading BERT encoder model on {device}..."
)

LLM_MODEL_NAME = config.get(
    "TEXT_TAG",
    "llm_model",
    fallback="bert-base-uncased"
)

tokenizer = AutoTokenizer.from_pretrained(
    LLM_MODEL_NAME
)

model = AutoModel.from_pretrained(
    LLM_MODEL_NAME
).to(device)

model.eval()


# ============================================================
# SPEAKER NORMALIZATION
# ============================================================

def _normalize_speaker(speaker):
    """
    Normalize speaker names.

    Examples:

        Guest-1 -> GUEST-1
        guest-1 -> GUEST-1
        Guest 1 -> GUEST_1
    """

    if speaker is None:
        return ""

    return (
        str(speaker)
        .strip()
        .upper()
        .replace(" ", "_")
    )


# ============================================================
# GET SPEAKER CONVERSATION
# ============================================================

def _collect_speaker_text(
    grouped_transcript,
    speaker
):
    """
    Collect the complete conversation for one speaker.

    Empty messages are ignored.
    """

    messages = grouped_transcript.get(
        speaker,
        []
    )

    texts = []

    for message in messages:

        if message is None:
            continue

        text = str(message).strip()

        if not text:
            continue

        texts.append(text)

    return " ".join(texts).strip()


# ============================================================
# GET GUEST-1 AND GUEST-2
# ============================================================

def _get_guest_conversations(grouped_transcript):
    """
    Extract only Guest-1 and Guest-2.

    Other speakers such as Unknown are ignored.
    """

    guest1_text = _collect_speaker_text(
        grouped_transcript,
        "Guest-1"
    )

    guest2_text = _collect_speaker_text(
        grouped_transcript,
        "Guest-2"
    )

    return guest1_text, guest2_text


# ============================================================
# MEAN POOLING
# ============================================================

def _mean_pool(
    last_hidden_state,
    attention_mask
):

    mask = (
        attention_mask
        .unsqueeze(-1)
        .expand(
            last_hidden_state.size()
        )
        .float()
    )

    summed = torch.sum(
        last_hidden_state * mask,
        dim=1
    )

    counts = torch.clamp(
        mask.sum(dim=1),
        min=1e-9
    )

    return summed / counts


# ============================================================
# TEXT EMBEDDING
# ============================================================

def _embed_text(text):

    encoded = tokenizer(
        text,
        return_tensors="pt",
        truncation=True,
        max_length=512,
        padding=True,
    )

    encoded = {
        key: value.to(device)
        for key, value in encoded.items()
    }

    with torch.no_grad():

        outputs = model(
            **encoded
        )

    embedding = _mean_pool(
        outputs.last_hidden_state,
        encoded["attention_mask"]
    )

    return F.normalize(
        embedding,
        p=2,
        dim=1
    )


# ============================================================
# BERT CONVERSATION SCORE
# ============================================================

def compute_bert_score(
    grouped_transcript
):
    """
    Calculate one BERT cosine-similarity score
    between the complete Guest-1 and Guest-2
    conversations.

    Guest-1:
        All Guest-1 messages are combined.

    Guest-2:
        All Guest-2 messages are combined.

    Unknown and other speakers are ignored.

    Returns:
        float between 0.0 and 1.0
    """

    guest1_text, guest2_text = (
        _get_guest_conversations(
            grouped_transcript
        )
    )

    # --------------------------------------------------------
    # Missing conversation
    # --------------------------------------------------------

    if not guest1_text:
        print(
            "Guest-1 conversation is empty."
        )
        return 0.0

    if not guest2_text:
        print(
            "Guest-2 conversation is empty."
        )
        return 0.0

    # --------------------------------------------------------
    # Display conversations
    # --------------------------------------------------------

    print("\n========================================")
    print("BERT CONVERSATION COMPARISON")
    print("========================================")

    print("\nGuest-1 conversation:")
    print(guest1_text)

    print("\nGuest-2 conversation:")
    print(guest2_text)

    # --------------------------------------------------------
    # Create embeddings
    # --------------------------------------------------------

    embedding_guest1 = _embed_text(
        guest1_text
    )

    embedding_guest2 = _embed_text(
        guest2_text
    )

    # --------------------------------------------------------
    # Cosine similarity
    # --------------------------------------------------------

    score = float(
        F.cosine_similarity(
            embedding_guest1,
            embedding_guest2
        ).item()
    )

    # --------------------------------------------------------
    # Keep score between 0 and 1
    # --------------------------------------------------------

    score = float(
        max(
            0.0,
            min(
                1.0,
                score
            )
        )
    )

    print(
        f"\nGuest-1 vs Guest-2 BERT score: "
        f"{score:.4f}"
    )

    print("========================================")

    return score


# ============================================================
# BERT SCORE FROM JSON
# ============================================================

def compute_bert_score_from_json(
    json_file,
    output_file
):
    """
    Load grouped speaker JSON and calculate one
    BERT similarity score between Guest-1 and Guest-2.

    The original grouped JSON is NOT modified.

    A separate JSON file is created containing:
        - Guest-1 conversation
        - Guest-2 conversation
        - BERT score
        - comparison information
        - execution timing
    """

    start_timestamp = datetime.now(
        timezone.utc
    )

    start_counter = time.perf_counter()

    # ========================================================
    # LOAD GROUPED JSON
    # ========================================================

    with open(
        json_file,
        "r",
        encoding="utf-8"
    ) as input_file:

        grouped_transcript = json.load(
            input_file
        )

    # ========================================================
    # VALIDATE JSON
    # ========================================================

    if not isinstance(
        grouped_transcript,
        dict
    ):

        raise ValueError(
            "Input JSON must contain "
            "speaker-grouped data."
        )

    # ========================================================
    # GET CONVERSATIONS
    # ========================================================

    guest1_text, guest2_text = (
        _get_guest_conversations(
            grouped_transcript
        )
    )

    # ========================================================
    # CALCULATE SCORE
    # ========================================================

    total_score = compute_bert_score(
        grouped_transcript
    )

    # ========================================================
    # END TIME
    # ========================================================

    end_timestamp = datetime.now(
        timezone.utc
    )

    total_duration = (
        time.perf_counter()
        - start_counter
    )

    # ========================================================
    # CREATE SEPARATE BERT RESULT
    # ========================================================

    bert_result = {

        "Guest-1": guest1_text,

        "Guest-2": guest2_text,

        "bert_score": total_score,

        "bert_comparison": {
            "comparison": "Guest-1 vs Guest-2",
            "comparison_type": "whole_conversation",
            "start_time": (
                start_timestamp.isoformat()
            ),
            "end_time": (
                end_timestamp.isoformat()
            ),
            "total_duration_seconds": round(
                total_duration,
                6
            )
        }
    }

    # ========================================================
    # SAVE SEPARATE BERT JSON
    # ========================================================

    with open(
        output_file,
        "w",
        encoding="utf-8"
    ) as result_file:

        json.dump(
            bert_result,
            result_file,
            indent=2,
            ensure_ascii=False
        )

    print(
        f"\nBERT result written to:\n"
        f"{output_file}"
    )

    return bert_result