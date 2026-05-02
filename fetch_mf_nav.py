"""
Fetch Live Mutual Fund NAVs from AMFI (Association of Mutual Funds in India)
Updates NAV for all funds in mf_data.json
"""

import json
import requests
from datetime import datetime
import re

def fetch_amfi_nav_data():
    """Fetch latest NAV data from AMFI"""
    url = "https://www.amfiindia.com/spages/NAVAll.txt"
    try:
        response = requests.get(url, timeout=10)
        response.raise_for_status()
        return response.text
    except Exception as e:
        print(f"Error fetching AMFI data: {e}")
        return None

def parse_amfi_data(amfi_text):
    """Parse AMFI NAV text file into a dictionary"""
    nav_dict = {}
    
    if not amfi_text:
        return nav_dict
    
    lines = amfi_text.strip().split('\n')
    
    for line in lines:
        # Skip header lines and empty lines
        if not line or line.startswith('Scheme Code') or ';' not in line:
            continue
        
        parts = line.split(';')
        if len(parts) >= 5:
            scheme_code = parts[0].strip()
            scheme_name = parts[3].strip()
            try:
                nav = float(parts[4].strip())
                nav_dict[scheme_name.lower()] = {
                    'code': scheme_code,
                    'name': scheme_name,
                    'nav': nav
                }
            except (ValueError, IndexError):
                continue
    
    return nav_dict

def fuzzy_match_fund(fund_name, amfi_dict):
    """Try to match fund name with AMFI data using improved fuzzy matching"""
    fund_lower = fund_name.lower()
    
    # Remove common suffixes for better matching
    cleanup_patterns = [
        r'\s*\(.*?\)',  # Remove folio numbers in parentheses
        r'\s*-\s*direct.*',  # Remove "- Direct Plan" variants
        r'\s*-\s*growth.*',  # Remove "- Growth" variants
        r'\s*direct\s*plan.*',
        r'\s*growth.*',
        r'\s*regular\s*plan.*'
    ]
    
    for pattern in cleanup_patterns:
        fund_lower = re.sub(pattern, '', fund_lower, flags=re.IGNORECASE)
    
    fund_lower = fund_lower.strip()
    
    # Extract key identifying words (brand + fund type)
    # Keep important compound terms together like "large cap", "small cap", "mid cap"
    key_words = []
    fund_tokens = fund_lower.split()
    
    i = 0
    while i < len(fund_tokens):
        word = fund_tokens[i]
        
        # Check for compound fund types
        if i + 1 < len(fund_tokens):
            next_word = fund_tokens[i + 1]
            # If current word is a size and next is "cap", keep them together
            if word in ['large', 'mid', 'small'] and next_word == 'cap':
                key_words.append(f"{word} cap")
                i += 2
                continue
        
        # Skip filler words
        if word not in ['fund', 'direct', 'plan', 'growth', 'regular', 'cap']:
            key_words.append(word)
        i += 1
    
    print(f"  Searching for: {' '.join(key_words)}")
    
    # Try exact match first
    if fund_lower in amfi_dict:
        return amfi_dict[fund_lower]
    
    # Try matching with key words
    best_match = None
    best_score = 0
    
    # First key word is usually the company/AMC name
    company_name = key_words[0] if key_words else ""
    
    for amfi_name, data in amfi_dict.items():
        # CRITICAL: Company/AMC name must match as a WORD (not substring)
        # Use word boundaries to avoid matching "uti" in "distribution"
        if company_name:
            # Check if company name appears as a standalone word at start
            if not (amfi_name.startswith(company_name + ' ') or 
                    amfi_name.startswith(company_name + '-')):
                continue
        
        # Check if all key words are in the AMFI name
        matches = sum(1 for word in key_words if word in amfi_name)
        
        # Also check for "direct" vs non-direct
        is_direct_fund = 'direct' in fund_name.lower()
        amfi_is_direct = 'direct' in amfi_name
        
        # Score the match
        score = matches * 10  # Base score
        
        if is_direct_fund == amfi_is_direct:
            score += 5  # Bonus for matching plan type
        
        # Penalty for mismatch in specific terms
        # Example: "large cap" should NOT match "large & mid cap"
        if 'large' in fund_lower:
            if 'large cap' in fund_lower or 'largecap' in fund_lower:
                # User wants "Large Cap" fund
                if ('large & mid' in amfi_name or 'large and mid' in amfi_name):
                    score -= 100  # Heavy penalty for wrong fund type
                elif 'large cap' in amfi_name or 'largecap' in amfi_name:
                    score += 10  # Bonus for exact match
        
        if 'small' in fund_lower:
            if 'small cap' in fund_lower or 'smallcap' in fund_lower:
                if ('small & mid' in amfi_name or 'small and mid' in amfi_name):
                    score -= 100
                elif 'small cap' in amfi_name or 'smallcap' in amfi_name:
                    score += 10
        
        if 'mid' in fund_lower and 'large' not in fund_lower:
            # User wants Mid Cap only
            if 'mid cap' in fund_lower or 'midcap' in fund_lower:
                if ('large & mid' in amfi_name or 'large and mid' in amfi_name):
                    score -= 100
                elif 'mid cap' in amfi_name or 'midcap' in amfi_name:
                    score += 10
        
        # Penalty for unwanted words
        # Example: "Nifty 50" should NOT match "Nifty Next 50"
        if 'next' not in fund_lower and 'next' in amfi_name:
            score -= 100  # Heavy penalty for "next" when not requested
        
        # Prefer Growth option over IDCW (dividend) - STRENGTHENED
        fund_has_growth = 'growth' in fund_name.lower()
        if fund_has_growth or 'direct' in fund_name.lower():
            if 'growth' in amfi_name or '-growth' in amfi_name:
                score += 50  # STRONG preference for growth (increased from 20)
            elif 'idcw' in amfi_name or 'dividend' in amfi_name or 'income distribution' in amfi_name:
                score -= 100  # HEAVY penalty for dividend/IDCW when looking for growth (increased from -50)
        
        # Extra bonus if user explicitly has "Growth" in fund name and AMFI has "GROWTH"
        if 'growth' in fund_lower and '-growth' in amfi_name:
            score += 30  # Additional bonus for exact growth match
        
        # Must have at least 2 key words matching
        if score > best_score and matches >= 2:
            best_score = score
            best_match = data
    
    if (best_match):
        print(f"  -> Matched: {best_match['name']}")
    
    return best_match

def update_mf_navs():
    """Update NAVs in mf_data.json with latest AMFI data"""
    print("Fetching latest NAV data from AMFI...")
    amfi_text = fetch_amfi_nav_data()
    
    if not amfi_text:
        print("Failed to fetch AMFI data")
        return
    
    print("Parsing AMFI data...")
    amfi_dict = parse_amfi_data(amfi_text)
    print(f"Loaded {len(amfi_dict)} fund NAVs from AMFI")
    
    # Load current MF data
    try:
        with open('mf_data.json', 'r', encoding='utf-8') as f:
            mf_data = json.load(f)
    except FileNotFoundError:
        print("mf_data.json not found")
        return
    
    # Create live NAV file
    live_navs = {}
    updated_count = 0
    
    for fund_key, fund_info in mf_data.items():
        fund_name = fund_info.get('fund_name', '')
        
        # Try to find matching NAV from AMFI
        amfi_match = fuzzy_match_fund(fund_name, amfi_dict)
        
        if amfi_match:
            live_navs[fund_key] = {
                'nav': amfi_match['nav'],
                'last_updated': datetime.now().strftime('%Y-%m-%d %H:%M:%S')
            }
            print(f"[OK] {fund_name}: Rs.{amfi_match['nav']}")
            updated_count += 1
        else:
            print(f"[X] {fund_name}: No match found")
    
    # Save live NAVs to JSON
    with open('mf_nav_live.json', 'w', encoding='utf-8') as f:
        json.dump(live_navs, f, indent=2, ensure_ascii=False)
    
    # Create JavaScript bridge file
    with open('mf_nav_bridge.js', 'w', encoding='utf-8') as f:
        f.write('window.mfNavBridge = ')
        json.dump(live_navs, f, indent=2, ensure_ascii=False)
        f.write(';\n')
    
    print(f"\n[OK] Updated {updated_count}/{len(mf_data)} funds")
    print(f"[OK] Saved to mf_nav_live.json and mf_nav_bridge.js")

if __name__ == '__main__':
    update_mf_navs()
