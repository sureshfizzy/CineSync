"""
Sports content detection patterns configuration

This file contains all the regex patterns used to identify sports content
from filenames. Patterns are organized by sport category for easy maintenance.
"""

# Motorsports patterns
MOTORSPORTS_PATTERNS = [
    r'\bFormula[_\s]*1\b',
    r'\bF1[_\s]*\d{4}',
    r'\bMotoGP\b',
    r'\bNASCAR\b',
    r'\bIndyCar\b',
    r'\bWRC\b',
    r'\bGP\d{4}',
    r'\bFormula[_\s]*1.*Grand[_\s]*Prix\b',
    r'\bF1.*Grand[_\s]*Prix\b',
    r'\bMotoGP.*Grand[_\s]*Prix\b'
]

# Football/Soccer patterns
FOOTBALL_PATTERNS = [
    r'\bPremier[_\s]*League\b',
    r'\bChampions[_\s]*League\b',
    r'\bWorld[_\s]*Cup\b',
    r'\bUEFA\b',
    r'\bFIFA\b'
]

# American Sports patterns
AMERICAN_SPORTS_PATTERNS = [
    r'\bNBA[_\s]*\d{4}',
    r'\bNFL[_\s]*\d{4}',
    r'\bMLB[_\s]*\d{4}',
    r'\bNHL[_\s]*\d{4}',
    r'\bSuper[_\s]*Bowl\b'
]

# Combat Sports patterns
COMBAT_SPORTS_PATTERNS = [
    r'\bUFC[_\s]*\d+',
    r'\bBoxing\b',
    r'\bMMA\b'
]

# Wrestling patterns
WRESTLING_PATTERNS = [
    r'\bPay[_\s\.]*Per[_\s\.]*View\b',
    r'\bAEW\b',
    r'\bCZW\b',
    r'\bWWE\b',
    r'\bWCW\b',
    r'\bECW\b',
    r'\bROH\b',
    r'\bNJPW\b',
    r'\bWWF\b',
    r'\bTNA\b',
    r'\bXPW\b',

    # Full Organization Names
    r'All[_\s\.]*Elite[_\s\.]*Wrestling',
    r'WWE[_\s\.]*ECW[_\s\.]*Unreleased',
    r'TNA[_\s\.]*Wrestling',
    r'Total[_\s\.]*Nonstop[_\s\.]*Action[_\s\.]*Wrestling',
    r'TNA[_\s\.]*Reaction',
    r'Impact[_\s\.]*Wrestling',
    r'Extreme[_\s\.]*Championship[_\s\.]*Wrestling',
    r'World[_\s\.]*Championship[_\s\.]*Wrestling',
    r'World[_\s\.]*Wrestling[_\s\.]*Entertainment',
    r'World[_\s\.]*Wrestling[_\s\.]*Federation',
    r'New[_\s\.]*Japan[_\s\.]*Pro[_\s\.]*Wrestling',
    r'Ring[_\s\.]*of[_\s\.]*Honor',

    # WWE Shows and Events
    r'Monday[_\s]*Raw',
    r'SmackDown',
    r'NXT',
    r'WrestleMania',
    r'Royal[_\s]*Rumble',
    r'SummerSlam',
    r'Hell[_\s]*in[_\s]*a[_\s]*Cell',
    r'Money[_\s]*in[_\s]*the[_\s]*Bank',
    r'TakeOver',
    r'WWE[_\s\.]*NXT[_\s\.]*Vengeance[_\s\.]*Day',
    r'WWE[_\s\.]*NXT[_\s\.]*The[_\s\.]*Great[_\s\.]*American[_\s\.]*Bash',
    r'WWE[_\s\.]*NXT[_\s\.]*TakeOver',
    r'WWE[_\s\.]*NXT[_\s\.]*Stand[_\s\.]*and[_\s\.]*Deliver',
    r'WWE[_\s\.]*NXT[_\s\.]*No[_\s\.]*Mercy',
    r'WWE[_\s\.]*NXT[_\s\.]*Deadline',
    r'WWE[_\s\.]*NXT[_\s\.]*Battleground',

    # Wrestling Documentaries and Specials
    r'All[_\s\.]*In[_\s\.]*2018[_\s\.]*PPV',
    r'All[_\s]*In[_\s]*2018',
    r'Eric[_\s]*Bischoff[_\s]*Sports[_\s]*Entertainments[_\s]*Most[_\s]*Controversial[_\s]*Figure',
    r'Bray[_\s\.]*Wyatt[_\s\.]*Becoming[_\s\.]*Immortal',
    r'The[_\s]*Nine[_\s]*Lives[_\s]*Of[_\s]*Vince[_\s]*McMahon',
    r'Biography[_\s]*The[_\s]*Life[_\s]*And[_\s]*Death[_\s]*Of[_\s]*Owen[_\s]*Hart',
    r'Andre[_\s\.]*the[_\s\.]*Giant',
    r'The[_\s\.]*John[_\s\.]*Cena[_\s\.]*Experience',
    r'John[_\s\.]*Cena[_\s\.]*Experience',
    r'The[_\s]*Life[_\s]*And[_\s]*Times[_\s]*Of[_\s]*Mr[_\s\.]*Perfect',
    r'The[_\s]*Spectacular[_\s]*Legacy[_\s]*Of[_\s]*The[_\s]*AWA',
    r'Macho[_\s]*Man[_\s]*The[_\s]*Randy[_\s]*Savage[_\s]*Story',
    r'Ricky[_\s]*Steamboat[_\s]*The[_\s]*Life[_\s]*Story[_\s]*Of[_\s]*The[_\s]*Dragon',
    r'Meeting[_\s]*Stone[_\s]*Cold',
    r'Hitman[_\s]*Hart[_\s]*Wrestling[_\s]*With[_\s]*Shadows',
    r'The[_\s]*Sheik',
    r'Straight[_\s]*Outta[_\s]*Dudleyville[_\s]*The[_\s]*Legacy[_\s]*Of[_\s]*The[_\s]*Dudley[_\s]*Boyz',
    r'American[_\s\.]*Nightmare[_\s\.]*Becoming[_\s\.]*Cody[_\s\.]*Rhodes',
    r'The[_\s]*American[_\s]*Dream[_\s]*The[_\s]*Dusty[_\s]*Rhodes[_\s]*Story',
    r'Beyond[_\s\.]*The[_\s\.]*Mat',
    r'Woooooo[_\s]*Becoming[_\s]*Ric[_\s]*Flair',
    r'ANGLE[_\s\.]*2023',

    # Generic Wrestling Terms
    r'\bWrestling\b',
    r'\bPPV\b',

    # ROH Specific with Date Range
    r'ROH[_\s]*-[_\s]*200[2-8]',
    r'ROH[_\s]*-[_\s]*19[0-9]{2}',
    r'ROH[_\s]*-[_\s]*20[0-9]{2}'
]

# Olympic and International Sports patterns
OLYMPIC_PATTERNS = [
    r'\bOlympics?\b',
    r'\bParalympic\b',
    r'\bCommonwealth[_\s]*Games\b'
]

# Individual Sports patterns
INDIVIDUAL_SPORTS_PATTERNS = [
    r'\bTennis[_\s]*\d{4}',
    r'\bGolf[_\s]*\d{4}',
    r'\bAthletics\b',
    r'\bSwimming\b',
    r'\bCycling\b'
]

# Combine all patterns into a single list
ALL_SPORTS_PATTERNS = (
    MOTORSPORTS_PATTERNS +
    FOOTBALL_PATTERNS +
    AMERICAN_SPORTS_PATTERNS +
    COMBAT_SPORTS_PATTERNS +
    WRESTLING_PATTERNS +
    OLYMPIC_PATTERNS +
    INDIVIDUAL_SPORTS_PATTERNS
)

def get_sports_patterns():
    """
    Get all sports detection patterns
    
    Returns:
        list: List of regex patterns for sports detection
    """
    return ALL_SPORTS_PATTERNS

def get_patterns_by_category():
    """
    Get sports patterns organized by category
    
    Returns:
        dict: Dictionary with category names as keys and pattern lists as values
    """
    return {
        'motorsports': MOTORSPORTS_PATTERNS,
        'football': FOOTBALL_PATTERNS,
        'american_sports': AMERICAN_SPORTS_PATTERNS,
        'combat_sports': COMBAT_SPORTS_PATTERNS,
        'wrestling': WRESTLING_PATTERNS,
        'olympic': OLYMPIC_PATTERNS,
        'individual_sports': INDIVIDUAL_SPORTS_PATTERNS
    }

def add_custom_pattern(pattern, category='custom'):
    """
    Add a custom sports pattern at runtime
    
    Args:
        pattern (str): Regex pattern to add
        category (str): Category for the pattern
    """
    ALL_SPORTS_PATTERNS.append(pattern)

def is_wrestling_content(filename):
    """
    Check if content is specifically wrestling-related
    
    Args:
        filename (str): Filename to check
        
    Returns:
        bool: True if wrestling content detected
    """
    import re
    for pattern in WRESTLING_PATTERNS:
        if re.search(pattern, filename, re.IGNORECASE):
            return True
    return False

def is_motorsports_content(filename):
    """
    Check if content is specifically motorsports-related
    
    Args:
        filename (str): Filename to check
        
    Returns:
        bool: True if motorsports content detected
    """
    import re
    for pattern in MOTORSPORTS_PATTERNS:
        if re.search(pattern, filename, re.IGNORECASE):
            return True
    return False
