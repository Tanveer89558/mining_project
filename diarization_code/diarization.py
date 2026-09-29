# diarization/diarization.py

import json
import re
import time
import azure.cognitiveservices.speech as speechsdk

import config

from Common.paths import (
    get_diarized_output_path,
    get_grouped_output_path,
)


DUPLICATE_WINDOW_TICKS = 30_000_000

MAPPING_FILE = "Common/mappings.json"


# ============================================================
# MAPPINGS
# ============================================================

def load_mappings(mapping_file):
    with open(mapping_file, "r", encoding="utf-8") as f:
        raw_mappings = json.load(f)

    lookup = {}

    for standard_term, aliases in raw_mappings.items():

        alias_list = [
            a.strip()
            for a in aliases.split(",")
        ]

        for alias in alias_list:
            lookup[alias.lower()] = standard_term

        lookup[standard_term.lower()] = standard_term

    return lookup


def replace_terms(text, lookup):
    """
    Replace aliases with standard terms.
    Case-insensitive matching.
    """

    aliases = sorted(
        lookup.keys(),
        key=len,
        reverse=True
    )

    for alias in aliases:

        pattern = re.compile(
            re.escape(alias),
            re.IGNORECASE
        )

        text = pattern.sub(
            lookup[alias],
            text
        )

    return text


def process_json(obj, lookup):

    if isinstance(obj, dict):

        for key, value in obj.items():

            if key == "text" and isinstance(value, str):

                obj[key] = replace_terms(
                    value,
                    lookup
                )

            else:

                obj[key] = process_json(
                    value,
                    lookup
                )

    elif isinstance(obj, list):

        obj = [
            process_json(item, lookup)
            for item in obj
        ]

    return obj


# ============================================================
# DUPLICATE CHECK
# ============================================================

def _is_duplicate_segment(
    segment,
    transcriptions
):

    normalized_text = " ".join(
        segment["text"].lower().split()
    )

    for previous in reversed(transcriptions):

        if previous["speaker"] != segment["speaker"]:
            continue

        previous_text = " ".join(
            previous["text"].lower().split()
        )

        if previous_text != normalized_text:
            continue

        if (
            segment["offset"]
            - previous["offset"]
            <= DUPLICATE_WINDOW_TICKS
        ):
            return True

        break

    return False


# ============================================================
# CALLBACKS
# ============================================================

def conversation_transcriber_recognition_canceled_cb(evt):

    print("Canceled event")


def conversation_transcriber_session_stopped_cb(evt):

    print("SessionStopped event")


def conversation_transcriber_transcribed_cb(
    evt,
    transcriptions
):

    if (
        evt.result.reason
        == speechsdk.ResultReason.RecognizedSpeech
    ):

        segment = {
            "speaker": evt.result.speaker_id,
            "text": evt.result.text.strip(),
            "offset": evt.result.offset,
            "duration": evt.result.duration,
        }

        if not _is_duplicate_segment(
            segment,
            transcriptions
        ):

            transcriptions.append(
                segment
            )

        print("\nTRANSCRIBED:")
        print(
            "\tText={}".format(
                segment["text"]
            )
        )
        print(
            "\tSpeaker ID={}\n".format(
                segment["speaker"]
            )
        )

    elif (
        evt.result.reason
        == speechsdk.ResultReason.NoMatch
    ):

        print(
            "\tNOMATCH: Speech could not be "
            "TRANSCRIBED: {}".format(
                evt.result.no_match_details
            )
        )


def conversation_transcriber_transcribing_cb(evt):

    print("TRANSCRIBING:")
    print(
        "\tText={}".format(
            evt.result.text
        )
    )
    print(
        "\tSpeaker ID={}".format(
            evt.result.speaker_id
        )
    )


def conversation_transcriber_session_started_cb(evt):

    print("SessionStarted event")


# ============================================================
# AZURE CONFIG
# ============================================================

def create_speech_config():

    if not config.AZURE_SPEECH_KEY:

        raise RuntimeError(
            "AZURE_SPEECH_KEY is not configured."
        )

    if config.AZURE_SPEECH_ENDPOINT:

        speech_config = speechsdk.SpeechConfig(
            subscription=config.AZURE_SPEECH_KEY,
            endpoint=config.AZURE_SPEECH_ENDPOINT,
        )

    elif config.AZURE_SPEECH_REGION:

        speech_config = speechsdk.SpeechConfig(
            subscription=config.AZURE_SPEECH_KEY,
            region=config.AZURE_SPEECH_REGION,
        )

    else:

        raise RuntimeError(
            "Configure either "
            "AZURE_SPEECH_ENDPOINT or "
            "AZURE_SPEECH_REGION."
        )

    return speech_config


# ============================================================
# DIARIZATION
# ============================================================

def recognize_from_file(audio_file):

    speech_config = create_speech_config()

    speech_config.speech_recognition_language = "en-US"

    speech_config.set_property(
        property_id=(
            speechsdk.PropertyId
            .SpeechServiceResponse_DiarizeIntermediateResults
        ),
        value="true",
    )

    audio_config = speechsdk.audio.AudioConfig(
        filename=audio_file
    )

    conversation_transcriber = (
        speechsdk.transcription.ConversationTranscriber(
            speech_config=speech_config,
            audio_config=audio_config,
        )
    )

    transcribing_stop = False

    transcriptions = []

    def stop_cb(evt):

        print(
            "CLOSING on {}".format(evt)
        )

        nonlocal transcribing_stop

        transcribing_stop = True

    # --------------------------------------------------------
    # CALLBACKS
    # --------------------------------------------------------

    conversation_transcriber.transcribed.connect(
        lambda evt:
        conversation_transcriber_transcribed_cb(
            evt,
            transcriptions,
        )
    )

    conversation_transcriber.transcribing.connect(
        conversation_transcriber_transcribing_cb
    )

    conversation_transcriber.session_started.connect(
        conversation_transcriber_session_started_cb
    )

    conversation_transcriber.session_stopped.connect(
        conversation_transcriber_session_stopped_cb
    )

    conversation_transcriber.canceled.connect(
        conversation_transcriber_recognition_canceled_cb
    )

    conversation_transcriber.session_stopped.connect(
        stop_cb
    )

    conversation_transcriber.canceled.connect(
        stop_cb
    )

    # --------------------------------------------------------
    # START
    # --------------------------------------------------------

    conversation_transcriber.start_transcribing_async()

    while not transcribing_stop:

        time.sleep(0.5)

    conversation_transcriber.stop_transcribing_async()

    return transcriptions


# ============================================================
# SAVE DIARIZED JSON
# ============================================================

def save_diarized_json(
    transcriptions,
    audio_file
):

    lookup = load_mappings(
        MAPPING_FILE
    )

    updated_data = process_json(
        transcriptions,
        lookup
    )

    output_file = get_diarized_output_path(
        audio_file
    )

    with open(
        output_file,
        "w",
        encoding="utf-8"
    ) as output:

        json.dump(
            updated_data,
            output,
            indent=2,
            ensure_ascii=False
        )

    print(
        f"\nDiarized JSON written to:\n"
        f"{output_file}"
    )

    return updated_data


# ============================================================
# CREATE GROUPED JSON
# ============================================================

def create_speaker_grouped_json(
    transcriptions,
    audio_file
):

    grouped_data = {}

    for segment in transcriptions:

        speaker = segment["speaker"]

        text = segment["text"].strip()

        if speaker not in grouped_data:

            grouped_data[speaker] = []

        grouped_data[speaker].append(
            text
        )

    output_file = get_grouped_output_path(
        audio_file
    )

    with open(
        output_file,
        "w",
        encoding="utf-8"
    ) as output:

        json.dump(
            grouped_data,
            output,
            indent=2,
            ensure_ascii=False
        )

    print(
        f"Speaker-grouped JSON written to:\n"
        f"{output_file}"
    )

    return grouped_data


# ============================================================
# MAIN DIARIZATION PIPELINE
# ============================================================

def run_diarization(audio_file):

    print("\n========================================")
    print("STARTING DIARIZATION")
    print("========================================")

    # Azure transcription + diarization
    transcriptions = recognize_from_file(
        audio_file
    )

    # Apply mapping
    final_data = save_diarized_json(
        transcriptions,
        audio_file
    )

    # Group speakers
    grouped_data = create_speaker_grouped_json(
        final_data,
        audio_file
    )

    print("\n========================================")
    print("DIARIZATION COMPLETED")
    print("========================================")

    return {
        "diarized": final_data,
        "grouped": grouped_data,
    }