LANGUAGE_ISO_CODES = {
    "English": "en-US",
    "Spanish": "es-ES",
    "French": "fr-FR",
    "German": "de-DE",
    "Italian": "it-IT",
    "Portuguese": "pt-PT",
    "Brazilian Portuguese": "pt-BR",
    "Russian": "ru-RU",
    "Japanese": "ja-JP",
    "Korean": "ko-KR",
    "Chinese (Simplified)": "zh-CN",
    "Chinese (Traditional)": "zh-TW",
    "Arabic": "ar-SA",
    "Dutch": "nl-NL",
    "Hindi": "hi-IN",
    "Swedish": "sv-SE",
    "Norwegian": "no-NO",
    "Danish": "da-DK",
    "Finnish": "fi-FI",
    "Polish": "pl-PL",
    "Turkish": "tr-TR",
    "Czech": "cs-CZ",
    "Hungarian": "hu-HU",
    "Thai": "th-TH",
    "Greek": "el-GR",
    "Hebrew": "he-IL",
    "Indonesian": "id-ID",
    "Vietnamese": "vi-VN",
    "Romanian": "ro-RO",
    "Malay": "ms-MY",
}

def get_iso_code(language_name):
    """
    Get the ISO code for a given language name, case-insensitive.
    Returns 'en-US' as default if language not found.
    """
    normalized_name = language_name.strip().lower()
    for name, iso in LANGUAGE_ISO_CODES.items():
        if name.lower() == normalized_name:
            return iso
    return "en-US"
