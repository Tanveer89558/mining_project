import os
import json
import config

from diarization_code.diarization import run_diarization
from regex_code.regex_parser import run_regex_parser
from diarization_code.bert_code import compute_bert_score_from_json

from Common.paths import get_grouped_output_path, get_bert_output_path


def main():

    audio_file = config.DEFAULT_AUDIO_FILE

    # ========================================================
    # STEP 1
    # DIARIZATION
    # ========================================================

    diarization_result = run_diarization(
        audio_file
    )

    grouped_data = diarization_result["grouped"]

    grouped_output_path = get_grouped_output_path(
        audio_file
    )

    print(
        f"\nGrouped JSON:\n"
        f"{grouped_output_path}"
    )

    # ========================================================
    # STEP 2
    # BERT SCORE
    # ========================================================

    bert_output_path = get_bert_output_path(
        audio_file
    )

    bert_result = compute_bert_score_from_json(
        grouped_output_path,
        bert_output_path
    )

    # ========================================================
    # STEP 3
    # REGEX EXTRACTION
    # ========================================================

    regex_result = run_regex_parser(
        grouped_data,
        audio_file
    )

    # ========================================================
    # COMPLETE
    # ========================================================

    print("\n")
    print("============================================")
    print("         PIPELINE COMPLETED")
    print("============================================")

    print(
        f"\nBERT JSON:\n"
        f"{bert_output_path}"
    )

    return {
        "diarization": diarization_result,
        "regex": regex_result,
        "bert_score": bert_result
    }


if __name__ == "__main__":

    try:

        main()

    except Exception as err:

        print(
            "\nPipeline failed:"
        )

        print(
            str(err)
        )

        raise