import os
import json
import logging
from typing import Dict, List, Optional, Any
from MediaHub.utils.logging_utils import log_message

# Disable urllib3 debug logging
logging.getLogger("urllib3").setLevel(logging.WARNING)

class SportsDBHelper:
    """Helper for SportsDB operations using scraped data"""
    
    def __init__(self):
        self.name_lookup = {}
        self.id_lookup = {}
        self._load_scraped_data()
    
    def _load_scraped_data(self):
        """Load scraped SportsDB data from JSON files"""
        try:
            current_dir = os.path.dirname(os.path.abspath(__file__))
            mediahub_dir = os.path.dirname(current_dir)
            data_dir = os.path.join(mediahub_dir, 'utils', 'helpers', 'data')
            
            # Load name lookup
            name_lookup_path = os.path.join(data_dir, 'sportsdb_name_lookup.json')
            if os.path.exists(name_lookup_path):
                with open(name_lookup_path, 'r', encoding='utf-8') as f:
                    self.name_lookup = json.load(f)
            else:
                log_message(f"SportsDB name lookup file not found at: {name_lookup_path}", level="WARNING")

            # Load ID lookup (for direct ID access)
            id_lookup_path = os.path.join(data_dir, 'sportsdb_id_lookup.json')
            if os.path.exists(id_lookup_path):
                with open(id_lookup_path, 'r', encoding='utf-8') as f:
                    self.id_lookup = json.load(f)
                
        except Exception as e:
            log_message(f"Error loading SportsDB scraped data: {e}", level="ERROR")
            self.name_lookup = {}
            self.id_lookup = {}
    
    def find_organization_league(self, organization_name: str) -> Optional[Dict[str, Any]]:
        """
        Find a league using scraped lookup data
        
        Args:
            organization_name: Name of the organization (e.g., 'WWE', 'Formula 1')
            
        Returns:
            League data or None if not found
        """
        if not organization_name:
            return None

        # Step 1: Try direct lookup in scraped data
        org_lower = organization_name.lower().strip()

        if org_lower in self.name_lookup:
            league_data = self.name_lookup[org_lower]
            return self._format_league_result(league_data)

        # Step 2: Try partial matching
        for lookup_key, league_data in self.name_lookup.items():
            if self._is_match(org_lower, lookup_key):
                return self._format_league_result(league_data)

        return None
    
    def _is_match(self, org_name: str, lookup_key: str) -> bool:
        """Enhanced matching for organization names"""
        # Direct matches
        if org_name in lookup_key or lookup_key in org_name:
            return True

        # Word-based matching with better filtering
        org_words = [word for word in org_name.split() if len(word) > 2]
        key_words = [word for word in lookup_key.split() if len(word) > 2]

        # Check if any significant words match
        for org_word in org_words:
            for key_word in key_words:
                if org_word.lower() in key_word.lower() or key_word.lower() in org_word.lower():
                    return True

        return False
    
    def _format_league_result(self, league_data: Dict[str, Any]) -> Dict[str, Any]:
        """Format league data to match expected API structure"""
        return {
            'league_id': league_data['id'],
            'league_name': league_data['name'],
            'sport': league_data['sport'].replace('-', ' ').title(),
            'country': 'Unknown',
            'description': None,
            'logo': None,
            'badge': None,
            'banner': None
        }

    def get_league_by_id(self, league_id: int) -> Optional[Dict[str, Any]]:
        """
        Get league data by ID
        
        Args:
            league_id: SportsDB league ID
            
        Returns:
            League data or None if not found
        """
        league_id_str = str(league_id)
        
        if league_id_str in self.id_lookup:
            league_data = self.id_lookup[league_id_str]
            return {
                'league_id': league_id,
                'league_name': league_data['name'],
                'sport': league_data['sport'].replace('-', ' ').title(),
                'country': 'Unknown',
                'description': None,
                'logo': None,
                'badge': None,
                'banner': None
            }
        
        return None
    
    def get_sport_category(self, organization_name: str) -> Optional[str]:
        """
        Get the sport category for an organization
        
        Args:
            organization_name: Name of the organization
            
        Returns:
            Sport category name or None if not found
        """
        league_data = self.find_organization_league(organization_name)
        return league_data['sport'] if league_data else None
    
    def list_leagues_by_sport(self, sport_name: str) -> List[Dict[str, Any]]:
        """
        List all leagues in a specific sport
        
        Args:
            sport_name: Name of the sport (e.g., 'fighting', 'motorsport')
            
        Returns:
            List of leagues in that sport
        """
        sport_lower = sport_name.lower().replace(' ', '-')
        leagues = []
        
        for league_data in self.id_lookup.values():
            if league_data['sport'] == sport_lower:
                leagues.append(self._format_league_result({
                    'id': int(league_data.get('id', 0)),
                    'name': league_data['name'],
                    'sport': league_data['sport']
                }))
        
        return leagues

# Global helper instance
sportsdb_helper = SportsDBHelper()

def get_organization_league(organization_name: str) -> Optional[Dict[str, Any]]:
    """
    Public interface to find league data for an organization
    
    Args:
        organization_name: Name of the organization
        
    Returns:
        League data or None if not found
    """
    return sportsdb_helper.find_organization_league(organization_name)

def get_sport_category(organization_name: str) -> Optional[str]:
    """
    Get the sport category for an organization
    
    Args:
        organization_name: Name of the organization
        
    Returns:
        Sport category name or None if not found
    """
    return sportsdb_helper.get_sport_category(organization_name)

def get_league_by_id(league_id: int) -> Optional[Dict[str, Any]]:
    """
    Get league data by ID
    
    Args:
        league_id: SportsDB league ID
        
    Returns:
        League data or None if not found
    """
    return sportsdb_helper.get_league_by_id(league_id)