import React from 'react';

/**
 * CityLandmarkIcon Component
 * Renders iconic architectural SVG Line Art silhouettes for destination cities in KAIRO.
 * 
 * Supports all 32 destinations in the catalog (Bangkok Wat Arun/Temple, Paris Eiffel Tower,
 * New York Liberty/Empire, Tokyo Fuji/Torii, London Big Ben, Rome Colosseum, Dubai Burj, etc.)
 */
export default function CityLandmarkIcon({ cityCode, cityName, className = '', size = 24 }) {
  const code = (cityCode || '').toUpperCase();
  const city = (cityName || '').toLowerCase();

  const props = {
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.8,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
    className: `flight-destination-icon-svg ${className}`.trim()
  };

  // 1. PARIS (CDG) - Eiffel Tower
  if (code === 'CDG' || city.includes('paris')) {
    return (
      <svg {...props}>
        <path d="M12 2L10 9H14L12 2Z" />
        <path d="M9 9H15L17 22H14.5L13.5 17H10.5L9.5 22H7L9 9Z" />
        <line x1="10" y1="13" x2="14" y2="13" />
      </svg>
    );
  }

  // 2. BANGKOK (BKK) - Wat Arun / Grand Palace Temple
  if (code === 'BKK' || city.includes('bangkok')) {
    return (
      <svg {...props}>
        <path d="M12 2L10 7H14L12 2Z" />
        <path d="M8 7H16L17 12H7L8 7Z" />
        <path d="M5 12H19L20 22H4L5 12Z" />
        <line x1="12" y1="12" x2="12" y2="22" />
        <line x1="2" y1="22" x2="22" y2="22" />
      </svg>
    );
  }

  // 3. NEW YORK (JFK) - Empire State / Freedom Tower
  if (code === 'JFK' || city.includes('york')) {
    return (
      <svg {...props}>
        <line x1="12" y1="2" x2="12" y2="5" />
        <path d="M10 5H14V9H10V5Z" />
        <path d="M8 9H16V14H8V9Z" />
        <path d="M6 14H18V22H6V14Z" />
        <line x1="9" y1="18" x2="9" y2="22" />
        <line x1="15" y1="18" x2="15" y2="22" />
        <line x1="2" y1="22" x2="22" y2="22" />
      </svg>
    );
  }

  // 4. TOKYO (NRT / HND) - Mt. Fuji & Torii Gate
  if (code === 'NRT' || code === 'HND' || city.includes('tokyo')) {
    return (
      <svg {...props}>
        <path d="M2 20L8 9L12 12L16 7L22 20H2Z" />
        <line x1="8" y1="15" x2="16" y2="15" />
        <line x1="10" y1="12" x2="10" y2="20" />
        <line x1="14" y1="12" x2="14" y2="20" />
      </svg>
    );
  }

  // 5. LONDON (LHR) - Big Ben Tower
  if (code === 'LHR' || city.includes('london')) {
    return (
      <svg {...props}>
        <path d="M12 2L10 5V8H14V5L12 2Z" />
        <path d="M9 8H15V13H9V8Z" />
        <path d="M10 13V22 M14 13V22" />
        <line x1="6" y1="22" x2="18" y2="22" />
        <circle cx="12" cy="10.5" r="1.5" fill="currentColor" />
      </svg>
    );
  }

  // 6. ROME (FCO) - Colosseum
  if (code === 'FCO' || city.includes('rome')) {
    return (
      <svg {...props}>
        <path d="M3 20V12C3 9 7 9 12 9C17 9 21 9 21 12V20H3Z" />
        <line x1="7" y1="12" x2="7" y2="20" />
        <line x1="11" y1="12" x2="11" y2="20" />
        <line x1="15" y1="12" x2="15" y2="20" />
        <line x1="19" y1="12" x2="19" y2="20" />
        <line x1="2" y1="20" x2="22" y2="20" />
      </svg>
    );
  }

  // 7. DUBAI (DXB) - Burj Khalifa
  if (code === 'DXB' || city.includes('dubai')) {
    return (
      <svg {...props}>
        <line x1="12" y1="2" x2="12" y2="6" />
        <path d="M11 6H13V10H11V6Z" />
        <path d="M10 10H14V15H10V10Z" />
        <path d="M8 15H16V22H8V15Z" />
        <line x1="4" y1="22" x2="20" y2="22" />
      </svg>
    );
  }

  // 8. ATHENS (ATH) - Parthenon Acropolis
  if (code === 'ATH' || city.includes('athens')) {
    return (
      <svg {...props}>
        <path d="M12 3L2 8H22L12 3Z" />
        <line x1="4" y1="11" x2="4" y2="19" />
        <line x1="8" y1="11" x2="8" y2="19" />
        <line x1="12" y1="11" x2="12" y2="19" />
        <line x1="16" y1="11" x2="16" y2="19" />
        <line x1="20" y1="11" x2="20" y2="19" />
        <line x1="2" y1="19" x2="22" y2="19" />
        <line x1="2" y1="22" x2="22" y2="22" />
      </svg>
    );
  }

  // 9. BARCELONA (BCN) - Sagrada Familia
  if (code === 'BCN' || city.includes('barcelona')) {
    return (
      <svg {...props}>
        <path d="M6 22V9L8 6L10 9V22" />
        <path d="M14 22V9L16 6L18 9V22" />
        <line x1="10" y1="14" x2="14" y2="14" />
        <line x1="12" y1="2" x2="12" y2="22" />
        <line x1="2" y1="22" x2="22" y2="22" />
      </svg>
    );
  }

  // 10. SYDNEY (SYD) - Opera House
  if (code === 'SYD' || city.includes('sydney')) {
    return (
      <svg {...props}>
        <path d="M2 18C4 12 9 10 10 18" />
        <path d="M8 18C10 10 16 8 17 18" />
        <path d="M15 18C17 12 21 11 22 18" />
        <line x1="1" y1="21" x2="23" y2="21" />
      </svg>
    );
  }

  // 11. AMSTERDAM (AMS) - Windmill
  if (code === 'AMS' || city.includes('amsterdam')) {
    return (
      <svg {...props}>
        <path d="M12 12L5 5 M12 12L19 5 M12 12L5 19 M12 12L19 19" />
        <path d="M9 14L8 22H16L15 14" />
        <circle cx="12" cy="12" r="2" />
      </svg>
    );
  }

  // 12. BERLIN (BER) - Brandenburg Gate
  if (code === 'BER' || city.includes('berlin')) {
    return (
      <svg {...props}>
        <path d="M3 6H21V9H3V6Z" />
        <line x1="5" y1="9" x2="5" y2="20" />
        <line x1="9" y1="9" x2="9" y2="20" />
        <line x1="15" y1="9" x2="15" y2="20" />
        <line x1="19" y1="9" x2="19" y2="20" />
        <line x1="2" y1="20" x2="22" y2="20" />
      </svg>
    );
  }

  // 13. SINGAPORE (SIN) - Marina Bay Sands
  if (code === 'SIN' || city.includes('singapore')) {
    return (
      <svg {...props}>
        <path d="M3 9C8 7 16 7 21 9V11H3V9Z" />
        <line x1="5" y1="11" x2="5" y2="21" />
        <line x1="12" y1="11" x2="12" y2="21" />
        <line x1="19" y1="11" x2="19" y2="21" />
        <line x1="2" y1="21" x2="22" y2="21" />
      </svg>
    );
  }

  // 14. RIO DE JANEIRO (GIG) - Christ the Redeemer
  if (code === 'GIG' || city.includes('rio')) {
    return (
      <svg {...props}>
        <path d="M12 4C13 4 13.5 4.5 13.5 5.5V8 M10.5 5.5C10.5 4.5 11 4 12 4" />
        <path d="M3 8H21V10H16V22H8V10H3V8Z" />
      </svg>
    );
  }

  // 15. TEL AVIV (TLV) - Mediterranean Coastal Towers
  if (code === 'TLV' || city.includes('tel aviv')) {
    return (
      <svg {...props}>
        <path d="M4 22V10L7 8L10 10V22" />
        <path d="M11 22V6L14 4L17 6V22" />
        <path d="M18 16C19 16 20 17 22 17" />
        <line x1="2" y1="22" x2="22" y2="22" />
      </svg>
    );
  }

  // 16. MADRID (MAD) - Puerta de Alcalá Arch
  if (code === 'MAD' || city.includes('madrid')) {
    return (
      <svg {...props}>
        <path d="M2 8H22V11H2V8Z" />
        <line x1="4" y1="11" x2="4" y2="20" />
        <line x1="8" y1="11" x2="8" y2="20" />
        <line x1="12" y1="11" x2="12" y2="20" />
        <line x1="16" y1="11" x2="16" y2="20" />
        <line x1="20" y1="11" x2="20" y2="20" />
        <path d="M6 16C6 14 8 14 8 16 M11 16C11 14 13 14 13 16 M16 16C16 14 18 14 18 16" />
        <line x1="2" y1="20" x2="22" y2="20" />
      </svg>
    );
  }

  // 17. KRAKOW (KRK) - Wawel Castle
  if (code === 'KRK' || city.includes('krakow')) {
    return (
      <svg {...props}>
        <path d="M3 20V12L7 10V20" />
        <line x1="7" y1="14" x2="17" y2="14" />
        <path d="M17 10L21 12V20" />
        <path d="M10 20V16L12 14L14 16V20" />
        <line x1="2" y1="20" x2="22" y2="20" />
      </svg>
    );
  }

  // 18. MUNICH (MUC) - Frauenkirche Twin Towers
  if (code === 'MUC' || city.includes('munich')) {
    return (
      <svg {...props}>
        <path d="M5 6C5 4 7 4 7 6V20H5V6Z" />
        <path d="M17 6C17 4 19 4 19 6V20H17V6Z" />
        <line x1="7" y1="12" x2="17" y2="12" />
        <path d="M9 20V15H15V20" />
        <line x1="3" y1="20" x2="21" y2="20" />
      </svg>
    );
  }

  // 19. VIENNA (VIE) - St. Stephen's Spire
  if (code === 'VIE' || city.includes('vienna')) {
    return (
      <svg {...props}>
        <path d="M12 2L8 10V20H16V10L12 2Z" />
        <path d="M6 20V14L8 12 M18 20V14L16 12" />
        <line x1="2" y1="20" x2="22" y2="20" />
      </svg>
    );
  }

  // 20. PRAGUE (PRG) - Charles Bridge & Castle
  if (code === 'PRG' || city.includes('prague')) {
    return (
      <svg {...props}>
        <path d="M2 18C4 16 7 16 9 18C11 16 14 16 16 18C18 16 21 16 22 18" />
        <path d="M6 16V8L9 6L12 8V16" />
        <path d="M15 16V10L17 8L19 10V16" />
        <line x1="2" y1="21" x2="22" y2="21" />
      </svg>
    );
  }

  // 21. BUDAPEST (BUD) - Parliament Building
  if (code === 'BUD' || city.includes('budapest')) {
    return (
      <svg {...props}>
        <path d="M12 3L10 7H14L12 3Z" />
        <line x1="4" y1="11" x2="4" y2="20" />
        <line x1="8" y1="11" x2="8" y2="20" />
        <line x1="12" y1="7" x2="12" y2="20" />
        <line x1="16" y1="11" x2="16" y2="20" />
        <line x1="20" y1="11" x2="20" y2="20" />
        <line x1="2" y1="11" x2="22" y2="11" />
        <line x1="2" y1="20" x2="22" y2="20" />
      </svg>
    );
  }

  // 22. LISBON (LIS) - Belém Tower
  if (code === 'LIS' || city.includes('lisbon')) {
    return (
      <svg {...props}>
        <path d="M14 6L12 3L10 6V12H14V6Z" />
        <path d="M4 12H20V20H4V12Z" />
        <line x1="7" y1="12" x2="7" y2="20" />
        <line x1="17" y1="12" x2="17" y2="20" />
        <line x1="2" y1="20" x2="22" y2="20" />
      </svg>
    );
  }

  // 23. DUBLIN (DUB) - Ha'penny Bridge / Spire
  if (code === 'DUB' || city.includes('dublin')) {
    return (
      <svg {...props}>
        <path d="M3 18C7 13 17 13 21 18" />
        <line x1="12" y1="2" x2="12" y2="20" />
        <line x1="2" y1="20" x2="22" y2="20" />
      </svg>
    );
  }

  // 24. MILAN (MXP) - Duomo Cathedral
  if (code === 'MXP' || city.includes('milan')) {
    return (
      <svg {...props}>
        <path d="M12 2L10 7V20H14V7L12 2Z" />
        <path d="M6 12L4 15V20H8V12" />
        <path d="M18 12L20 15V20H16V12" />
        <line x1="2" y1="20" x2="22" y2="20" />
      </svg>
    );
  }

  // 25. ZURICH (ZRH) - Swiss Alps Peak
  if (code === 'ZRH' || city.includes('zurich')) {
    return (
      <svg {...props}>
        <path d="M2 20L9 8L13 13L17 6L22 20H2Z" />
        <path d="M17 6L15 10L17 11" />
        <line x1="2" y1="20" x2="22" y2="20" />
      </svg>
    );
  }

  // 26. LOS ANGELES (LAX) - Hollywood Palm Trees
  if (code === 'LAX' || city.includes('angeles')) {
    return (
      <svg {...props}>
        <line x1="9" y1="20" x2="9" y2="10" />
        <path d="M9 10C7 8 4 9 3 11 M9 10C11 7 14 8 15 10 M9 10C7 12 5 13 3 14 M9 10C12 12 14 12 16 13" />
        <line x1="2" y1="20" x2="22" y2="20" />
      </svg>
    );
  }

  // 27. MIAMI (MIA) - Palm Tree & Sun
  if (code === 'MIA' || city.includes('miami')) {
    return (
      <svg {...props}>
        <line x1="12" y1="20" x2="12" y2="10" />
        <path d="M12 10C10 7 7 8 5 10 M12 10C14 7 17 8 19 10 M12 10C9 12 7 14 5 15 M12 10C15 12 17 14 19 15" />
        <circle cx="18" cy="6" r="2.5" />
        <line x1="2" y1="20" x2="22" y2="20" />
      </svg>
    );
  }

  // 28. SEOUL (ICN) - Gyeongbokgung Palace Gate
  if (code === 'ICN' || city.includes('seoul')) {
    return (
      <svg {...props}>
        <path d="M2 8C6 6 18 6 22 8V11H2V8Z" />
        <line x1="4" y1="11" x2="4" y2="20" />
        <line x1="9" y1="11" x2="9" y2="20" />
        <line x1="15" y1="11" x2="15" y2="20" />
        <line x1="20" y1="11" x2="20" y2="20" />
        <path d="M10 20V15C10 13 14 13 14 15V20" />
        <line x1="2" y1="20" x2="22" y2="20" />
      </svg>
    );
  }

  // 29. COPENHAGEN (CPH) - Nyhavn Gable Houses
  if (code === 'CPH' || city.includes('copenhagen')) {
    return (
      <svg {...props}>
        <path d="M3 20V10L7 7L11 10V20" />
        <path d="M11 20V8L16 5L21 8V20" />
        <line x1="2" y1="20" x2="22" y2="20" />
      </svg>
    );
  }

  // 30. EDINBURGH (EDI) - Edinburgh Castle
  if (code === 'EDI' || city.includes('edinburgh')) {
    return (
      <svg {...props}>
        <path d="M2 20L4 14V10L7 8L10 10V14" />
        <path d="M10 14H14" />
        <path d="M14 14V8L17 6L20 8V20" />
        <line x1="7" y1="14" x2="7" y2="20" />
        <line x1="17" y1="14" x2="17" y2="20" />
        <line x1="2" y1="20" x2="22" y2="20" />
      </svg>
    );
  }

  // 31. HONG KONG (HKG) - Bank of China / Skyscraper
  if (code === 'HKG' || city.includes('hong kong')) {
    return (
      <svg {...props}>
        <path d="M12 2L6 8V22H18V8L12 2Z" />
        <line x1="6" y1="8" x2="18" y2="18" />
        <line x1="18" y1="8" x2="6" y2="18" />
        <line x1="12" y1="2" x2="12" y2="22" />
        <line x1="2" y1="22" x2="22" y2="22" />
      </svg>
    );
  }

  // DEFAULT / FALLBACK - Globe Compass Landmark
  return (
    <svg {...props}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 3A14 14 0 0 0 12 21A14 14 0 0 0 12 3Z" />
      <line x1="3" y1="12" x2="21" y2="12" />
    </svg>
  );
}
