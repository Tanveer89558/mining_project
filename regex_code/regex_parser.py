# regex_parser/regex_parser.py

import json
import re

from Common.paths import (
    get_regex_output_path,
)


# ============================================================
# REGEX PATTERNS
# ============================================================

TRUCK_PATTERN = re.compile(
    r"\b(?:haul\s+)?truck"
    r"(?:\s*(?:id|number|no\.?)\s*)?"
    r"[:#-]?\s*(\d{1,4})\b",
    re.IGNORECASE
)

SHOVEL_PATTERN = re.compile(
    r"\bshovel"
    r"(?:\s*(?:id|number|no\.?)\s*)?"
    r"[:#-]?\s*(\d{1,3})\b",
    re.IGNORECASE
)

POCKET_PATTERN = re.compile(
    r"\bpocket"
    r"(?:\s*(?:id|number|no\.?)\s*)?"
    r"[:#-]?\s*(\d{1,3})\b",
    re.IGNORECASE
)

EQUIPMENT_ID_PATTERN = re.compile(
    r"\b(?:equipment(?:\s*id)?|equip(?:ment)?\s*id)"
    r"\s*[:#-]?\s*([A-Za-z0-9_-]+)\b",
    re.IGNORECASE
)

BENCH_PATTERN = re.compile(
    r"\bbench\s*(?:number\s*)?(\d{2,3})\b",
    re.IGNORECASE
)

LEVEL_PATTERN = re.compile(
    r"\b(?:level|lvl)\s*(\d{1,2})\b",
    re.IGNORECASE
)

MOVEMENT_PATTERN = re.compile(
    r"\b(?:enter(?:ing)?|leav(?:e|ing)|approach(?:ing)?|"
    r"inbound|outbound|revers(?:e|ing)|on\s+(?:the\s+)?way)\b",
    re.IGNORECASE
)

LOADING_PATTERN = re.compile(
    r"\b(?:load(?:ing)?|tipp(?:ing|ed)?|spot(?:ting)?)\b",
    re.IGNORECASE
)

PROCEED_PATTERN = re.compile(
    r"\b(?:proceed|proceeding|clear|cleared|approved)\b",
    re.IGNORECASE
)

HOLD_PATTERN = re.compile(
    r"\b(?:hold|holding|stop|stopped|negative|"
    r"stand\s*down|wait)\b",
    re.IGNORECASE
)

AMBIGUOUS_PATTERN = re.compile(
    r"\b(?:yeah|yep|yup|copy|copied|roger|ok|okay|"
    r"mate|righto|sure|go\s*ahead)\b",
    re.IGNORECASE
)

ACKNOWLEDGMENT_PATTERN = re.compile(
    r"\b(?:copy\s+(?:that|this)|acknowledged|roger\s+that|"
    r"confirmed|understood)\b",
    re.IGNORECASE
)


# ============================================================
# O -> 0
# ============================================================

def convert_o_to_zero(text):

    return re.sub(
        r"(?<=\d)[Oo]|[Oo](?=\d)",
        "0",
        text
    )


# ============================================================
# EXTRACTION HELPERS
# ============================================================

def extract_first(pattern, text):

    match = pattern.search(text)

    if match:
        return match.group(1)

    return None


def extract_keyword(pattern, text):

    match = pattern.search(text)

    if match:
        return match.group(0)

    return None


# ============================================================
# SPEAKER DETAILS
# ============================================================

def extract_speaker_details(messages):

    text = " ".join(messages)

    text = convert_o_to_zero(text)

    details = {

        "truck_id":
            extract_first(
                TRUCK_PATTERN,
                text
            ),

        "shovel_id":
            extract_first(
                SHOVEL_PATTERN,
                text
            ),

        "pocket_id":
            extract_first(
                POCKET_PATTERN,
                text
            ),

        "equipment_id":
            extract_first(
                EQUIPMENT_ID_PATTERN,
                text
            ),

        "bench":
            extract_first(
                BENCH_PATTERN,
                text
            ),

        "level":
            extract_first(
                LEVEL_PATTERN,
                text
            ),

        "movement":
            extract_keyword(
                MOVEMENT_PATTERN,
                text
            ),

        "loading":
            extract_keyword(
                LOADING_PATTERN,
                text
            ),
    }

    return details


# ============================================================
# COMPARE SPEAKERS
# ============================================================

def compare_speaker_details(
    guest1_details,
    guest2_details
):

    fields_to_compare = [
        "truck_id",
        "shovel_id",
        "pocket_id",
        "equipment_id",
        "bench",
        "level"
    ]

    mismatches = {}

    for field in fields_to_compare:

        guest1_value = guest1_details.get(
            field
        )

        guest2_value = guest2_details.get(
            field
        )

        if (
            guest1_value is not None
            and guest2_value is not None
        ):

            if guest1_value != guest2_value:

                mismatches[field] = {

                    "Guest-1":
                        guest1_value,

                    "Guest-2":
                        guest2_value
                }

    if mismatches:

        return "Mis Matched", mismatches

    return "Matched", {}


# ============================================================
# STATUS
# ============================================================

def extract_status(guest2_text):

    if HOLD_PATTERN.search(
        guest2_text
    ):

        return "HOLD"

    if PROCEED_PATTERN.search(
        guest2_text
    ):

        return "PROCEED"

    if AMBIGUOUS_PATTERN.search(
        guest2_text
    ):

        return "AMBIGUOUS"

    return None


# ============================================================
# PARSER
# ============================================================

def parse_conversation(data):

    guest1_messages = data.get(
        "Guest-1",
        []
    )

    guest2_messages = data.get(
        "Guest-2",
        []
    )

    guest1_details = extract_speaker_details(
        guest1_messages
    )

    guest2_details = extract_speaker_details(
        guest2_messages
    )

    guest1_text = " ".join(
        convert_o_to_zero(msg)
        for msg in guest1_messages
    )

    acknowledgment = extract_keyword(
        ACKNOWLEDGMENT_PATTERN,
        guest1_text
    )

    flag, mismatches = compare_speaker_details(
        guest1_details,
        guest2_details
    )

    # --------------------------------------------------------
    # STOP IF MISMATCH
    # --------------------------------------------------------

    if flag == "Mis Matched":

        return {

            "flag": "Mis Matched",

            "status": "Mis Matched",

            "acknowledgment": acknowledgment,

            "mismatches": mismatches,

            "Guest-1":
                guest1_details,

            "Guest-2":
                guest2_details
        }

    # --------------------------------------------------------
    # DETAILS MATCHED
    # --------------------------------------------------------

    guest2_text = " ".join(
        convert_o_to_zero(msg)
        for msg in guest2_messages
    )

    status = extract_status(
        guest2_text
    )

    return {

        "flag": "Matched",

        "truck_id":
            guest1_details["truck_id"] or guest2_details["truck_id"],

        "shovel_id":
            guest1_details["shovel_id"] or guest2_details["shovel_id"],

        "pocket_id":
            guest1_details["pocket_id"] or guest2_details["pocket_id"],

        "equipment_id":
            guest1_details["equipment_id"] or guest2_details["equipment_id"],

        "bench":
            guest1_details["bench"] or guest2_details["bench"],

        "level":
            guest1_details["level"] or guest2_details["level"],

        "movement":
            guest1_details["movement"] or guest2_details["movement"],

        "loading":
            guest1_details["loading"] or guest2_details["loading"],

        "acknowledgment": acknowledgment,

        "status": status
    }


# ============================================================
# RUN REGEX PIPELINE
# ============================================================

def run_regex_parser(
    grouped_data,
    audio_file
):

    print("\n========================================")
    print("STARTING REGEX EXTRACTION")
    print("========================================")

    result = parse_conversation(
        grouped_data
    )

    output_file = get_regex_output_path(
        audio_file
    )

    with open(
        output_file,
        "w",
        encoding="utf-8"
    ) as f:

        json.dump(
            result,
            f,
            indent=2,
            ensure_ascii=False
        )

    print(
        f"\nRegex output written to:\n"
        f"{output_file}"
    )

    print("\nRegex Result:")
    print(
        json.dumps(
            result,
            indent=2,
            ensure_ascii=False
        )
    )

    print("\n========================================")
    print("REGEX EXTRACTION COMPLETED")
    print("========================================")

    return result