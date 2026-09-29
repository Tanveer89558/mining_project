# Common/paths.py

import os


# ============================================================
# BASE DIRECTORIES
# ============================================================

BASE_DIR = os.path.dirname(
    os.path.dirname(
        os.path.abspath(__file__)
    )
)

INPUT_DIR = os.path.join(
    BASE_DIR,
    "input"
)

OUTPUT_DIR = os.path.join(
    BASE_DIR,
    "output"
)


# ============================================================
# CREATE DIRECTORIES
# ============================================================

os.makedirs(INPUT_DIR, exist_ok=True)
os.makedirs(OUTPUT_DIR, exist_ok=True)


# ============================================================
# INPUT FILE
# ============================================================

def get_input_audio_path(filename):
    """
    Return full path of an input audio file.
    """

    return os.path.join(
        INPUT_DIR,
        filename
    )


# ============================================================
# OUTPUT FOLDER
# ============================================================

def get_output_folder(audio_file):
    """
    Creates an output folder based on the input filename.

    Example:

        ack_noisy_testfile.wav

    becomes:

        output/
            ack_noisy_testfile/
    """

    filename = os.path.basename(audio_file)

    filename_without_extension = os.path.splitext(
        filename
    )[0]

    output_folder = os.path.join(
        OUTPUT_DIR,
        filename_without_extension
    )

    os.makedirs(
        output_folder,
        exist_ok=True
    )

    return output_folder


# ============================================================
# OUTPUT FILES
# ============================================================

def get_diarized_output_path(audio_file):
    output_folder = get_output_folder(audio_file)

    filename = os.path.splitext(
        os.path.basename(audio_file)
    )[0]

    return os.path.join(
        output_folder,
        f"{filename}_diarized.json"
    )


def get_grouped_output_path(audio_file):
    output_folder = get_output_folder(audio_file)

    filename = os.path.splitext(
        os.path.basename(audio_file)
    )[0]

    return os.path.join(
        output_folder,
        f"{filename}_grouped.json"
    )


def get_regex_output_path(audio_file):
    output_folder = get_output_folder(audio_file)

    filename = os.path.splitext(
        os.path.basename(audio_file)
    )[0]

    return os.path.join(
        output_folder,
        f"{filename}_regex.json"
    )

def get_bert_output_path(audio_file):
    """
    Returns:
        output/<filename>/<filename>_bert_score.json
    """

    audio_name = os.path.splitext(
        os.path.basename(audio_file)
    )[0]

    output_folder = os.path.join(
        OUTPUT_DIR,
        audio_name
    )

    os.makedirs(
        output_folder,
        exist_ok=True
    )

    return os.path.join(
        output_folder,
        f"{audio_name}_bert_score.json"
    )