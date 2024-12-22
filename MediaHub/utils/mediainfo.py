import re
import os
import json

def load_keywords(filepath: str) -> dict:
    """
    Loads codec and pattern keywords from a JSON file.
    """
    with open(filepath, 'r') as file:
        return json.load(file)

keywords = load_keywords(os.path.join(os.getcwd(), 'MediaHub', 'utils', 'mediainfo.json'))

def extract_media_info(filepath: str, keywords: dict) -> dict:
    """
    Extracts detailed media information from a given file path (filename and parent folders)
    using dynamic patterns from a JSON file.
    """
    media_info = {}

    filename = os.path.basename(filepath)
    parent_folder = os.path.basename(os.path.dirname(filepath))
    sources = [filename, parent_folder]

    def normalize_source_name(source_name: str) -> str:
        return source_name.replace('-', '').lower()

    # Extract Codecs
    for source in sources:
        for codec in keywords["VideoCodecs"]:
            if re.search(codec.replace('.', r'\.'), source, re.IGNORECASE):
                media_info['VideoCodec'] = codec.replace('.', '')
                break

    audio_codecs = []
    for source in sources:
        for codec in keywords["AudioCodecs"]:
            if re.search(codec.replace('.', r'\.'), source, re.IGNORECASE):
                audio_codecs.append(codec)

    if audio_codecs:
        media_info['AudioCodec'] = " ".join(audio_codecs)


    for source in sources:
        channels_match = re.search(r'(5\.1|7\.1|2\.0)', source, re.IGNORECASE)
        if channels_match:
            media_info['AudioChannels'] = channels_match.group(0)
            break

    # Extract Languages
    for source in sources:
        valid_languages = keywords["ValidLanguages"]

        # Construct the language map with full name -> two-letter code -> three-letter code
        language_map = {
            long_name.upper(): short_code
            for long_name, short_code in zip(valid_languages[::3], valid_languages[1::3])
        }

        language_map.update({
            short_code.upper(): short_code
            for short_code in valid_languages[1::3]
        })

        language_map.update({
            three_letter.upper(): short_code.upper()
            for short_code, three_letter in zip(valid_languages[1::3], valid_languages[2::3])
        })

        filtered_languages = []

        lang_pattern = r'\b(?:' + '|'.join(
            re.escape(short_code) + r'|' + re.escape(long_name.upper()) + r'|' + re.escape(three_letter)
            for long_name, short_code, three_letter in zip(valid_languages[::3], valid_languages[1::3], valid_languages[2::3])
        ) + r')\b'

        matches = re.findall(lang_pattern, source.upper())
        for match in matches:
            if match.upper() in language_map:
                filtered_languages.append(language_map.get(match.upper(), match.upper()))

        if filtered_languages:
            media_info['Languages'] = sorted(set(filtered_languages))
            break

    for source in sources:
        dv_match = re.search(r'do?vi|dolby\.?vision', source, re.IGNORECASE)
        if dv_match:
            media_info['DynamicRange'] = 'DV'
            continue

    for source in sources:
        for version in keywords["MovieVersions"]:
            if re.search(version, source, re.IGNORECASE):
                media_info['MovieVersions'] = version
                break

    for source in sources:
        for service in keywords["StreamingServices"]:
            if re.search(r'\b' + re.escape(service) + r'\b', source, re.IGNORECASE):
                media_info['StreamingServices'] = service
                break

    # Extract Resolution and Source
    for source in sources:
        for resolution in keywords["Resolutions"]:
            if re.search(resolution, source, re.IGNORECASE):
                media_info['Resolution'] = resolution.lower()
                for source_type in keywords.get("Sources", []):
                    normalized_source_type = normalize_source_name(source_type)
                    if normalized_source_type in normalize_source_name(source):
                        media_info['Resolution'] = f"{source_type}-{media_info['Resolution']}"
                        break
                break

    return media_info

def format_media_info(media_info: dict) -> str:
    """
    Formats the media information into the desired bracket format.
    """
    formatted_parts = []

    if 'VideoCodec' in media_info:
        formatted_parts.append(f"[{media_info['VideoCodec']}]")

    audio_parts = []
    if 'AudioAtmos' in media_info:
        audio_parts.append(media_info['AudioAtmos'])
    elif 'AudioCodec' in media_info:
        audio_parts.append(media_info['AudioCodec'])
    if 'AudioChannels' in media_info:
        audio_parts.append(media_info['AudioChannels'])
    if audio_parts:
        formatted_parts.append(f"[{' '.join(audio_parts)}]")

    if 'Languages' in media_info:
        formatted_parts.append(f"[{'+'.join(media_info['Languages'])}]")

    if 'Resolution' in media_info:
        resolution_part = media_info['Resolution']
        if 'Source' in media_info:
            resolution_part = f"{media_info['Source']}-{resolution_part}"
        formatted_parts.append(f"[{resolution_part}]")

    return "".join(formatted_parts)
