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

    # Extract Codecs
    for source in sources:
        for codec in keywords["VideoCodecs"]:
            if re.search(codec.replace('.', r'\.'), source, re.IGNORECASE):
                media_info['VideoCodec'] = codec.replace('.', '')
                break

    for source in sources:
        for codec in keywords["AudioCodecs"]:
            if re.search(codec.replace('.', r'\.'), source, re.IGNORECASE):
                media_info['AudioCodec'] = codec
                break
        if "AudioAtmos" in keywords:
            for atmos in keywords["AudioAtmos"]:
                if re.search(atmos, source, re.IGNORECASE):
                    media_info['AudioAtmos'] = atmos
                    break

    for source in sources:
        channels_match = re.search(r'(?:DDP)?(5\.1|7\.1|2\.0)', source, re.IGNORECASE)
        if channels_match:
            media_info['AudioChannels'] = channels_match.group(0)
            break

    for source in sources:
        bracket_match = re.findall(r'\[([^\]]+)\]', source)
        paren_match = re.findall(r'\(([^\)]+)\)', source)
        valid_languages = keywords["ValidLanguages"]
        language_map = {long_name: short_code for long_name, short_code in zip(valid_languages[::2], valid_languages[1::2])}
        filtered_languages = []

        if bracket_match:
            for block in bracket_match:
                lang_codes = re.split(r'\s*[+\-]\s*', block)
                for lang in lang_codes:
                    clean_lang = lang.strip().upper()
                    for word in clean_lang.split():
                        if word in valid_languages:
                            lang_code = language_map.get(word, word)
                            filtered_languages.append(lang_code)

        if paren_match:
            for block in paren_match:
                lang_codes = re.split(r'\s*[+\-]\s*', block)
                for lang in lang_codes:
                    clean_lang = lang.strip().upper()
                    for word in clean_lang.split():
                        if word in valid_languages:
                            lang_code = language_map.get(word, word)
                            filtered_languages.append(lang_code)

        lang_match = re.findall(r'\b[A-Z]{2,}\b', source)

        filtered_languages += [language_map.get(lang.upper(), lang.upper())
                             for lang in lang_match
                             if lang.upper() in valid_languages]


        if filtered_languages:
            media_info['Languages'] = list(set(filtered_languages))
            break

    for source in sources:
        for dr in keywords["DynamicRange"]:
            if re.search(dr.replace('+', r'\+'), source, re.IGNORECASE):
                media_info['DynamicRange'] = dr
                break

    for source in sources:
        for resolution in keywords["Resolutions"]:
            if re.search(resolution, source, re.IGNORECASE):
                media_info['Resolution'] = resolution.lower()
                break

    for source in sources:
        for version in keywords["MovieVersions"]:
            if re.search(version, source, re.IGNORECASE):
                media_info['MovieVersion'] = version
                break

    for source in sources:
        for service in keywords["StreamingServices"]:
            if re.search(service, source, re.IGNORECASE):
                media_info['StreamingService'] = service
                break

    return media_info
