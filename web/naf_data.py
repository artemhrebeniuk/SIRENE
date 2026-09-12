"""
NAF (Nomenclature of French Activities) dictionary with clear English descriptions
and French official activity designations.
"""

NAF_LABELS_EN = {
    # Section A - Agriculture, forestry and fishing
    "01.11Z": "Cereal, Legume & Oilseed Farming",
    "01.21Z": "Grape Growing & Vineyards",
    "01.41Z": "Dairy Cattle Farming",
    "01.42Z": "Beef Cattle & Livestock Farming",
    "02.20Z": "Logging & Forestry",
    "03.11Z": "Marine Fishing",
    
    # Section C - Manufacturing
    "10.71A": "Industrial Bakery & Pastry Production",
    "10.71C": "Artisanal Bakery & Pastry Shops",
    "10.71D": "Pastry & Confectionery Making",
    "10.89Z": "Other Food Products Manufacturing",
    "11.02B": "Winemaking & Viticulture",
    "23.63Z": "Ready-Mix Concrete Manufacturing",
    "25.11Z": "Metal Structures & Framework Manufacturing",
    "25.62B": "Industrial Mechanical Machining",
    "31.09B": "Furniture & Cabinet Making",
    "33.12Z": "Industrial Machinery Repair & Maintenance",
    
    # Section F - Construction & Real Estate Works
    "41.10A": "Residential Real Estate Development",
    "41.10D": "Real Estate Project Legal Holdings",
    "41.20A": "Single-Family Home Construction",
    "41.20B": "Commercial & Residential Building Construction",
    "43.11Z": "Demolition Works",
    "43.12A": "Earthmoving & Site Preparation",
    "43.21A": "Electrical Installation Services",
    "43.22A": "Plumbing, Water & Gas Installation",
    "43.22B": "HVAC & Thermal Equipment Installation",
    "43.31Z": "Plastering & Drywall Works",
    "43.32A": "Carpentry & Joinery (Wood & PVC)",
    "43.33Z": "Floor & Wall Tiling Installation",
    "43.34Z": "Painting & Glazing Works",
    "43.91A": "Roof Framework & Timber Construction",
    "43.91B": "Roofing & Cladding Installation",
    "43.99C": "Masonry & Structural Brickwork",
    
    # Section G - Wholesale & Retail Trade
    "45.11Z": "Passenger Car & Light Vehicle Sales",
    "45.20A": "Automotive Repair & Vehicle Maintenance",
    "45.31Z": "Wholesale of Automotive Equipment & Parts",
    "46.73A": "Wholesale of Wood & Building Materials",
    "47.11A": "Retail Sale of Frozen Food Products",
    "47.11B": "General Grocery Stores",
    "47.11D": "Supermarkets",
    "47.11F": "Hypermarkets",
    "47.22Z": "Retail Butcher Shops & Meat Products",
    "47.24Z": "Retail Bread, Pastry & Confectionery",
    "47.71Z": "Retail Clothing & Apparel Stores",
    "47.73Z": "Retail Pharmacies & Chemists",
    "47.91A": "Mail Order & Catalog Retail",
    "47.91B": "E-Commerce & Online Retail Stores",
    
    # Section H - Transportation & Logistics
    "49.32Z": "Taxi & Private Chauffeur Services (VTC)",
    "49.41A": "Long-Distance Road Freight Transport",
    "49.41B": "Local Road Freight & Distribution Transport",
    "52.21Z": "Ground Transport Support & Parking Services",
    "53.20Z": "Courier & Express Parcel Delivery",
    
    # Section I - Accommodation & Food Services
    "55.10Z": "Hotels & Commercial Lodging",
    "55.20Z": "Holiday Rentals & Tourist Accommodation",
    "56.10A": "Traditional Restaurants",
    "56.10B": "Cafeterias & Self-Service Restaurants",
    "56.10C": "Fast Food & Quick Service Restaurants",
    "56.21Z": "Event Catering Services",
    "56.30Z": "Bars, Cafes & Drinking Places",
    
    # Section J - Information & Communication Technology
    "58.11Z": "Book Publishing",
    "58.29C": "Software Application Publishing (SaaS)",
    "62.01Z": "Software Development & Computer Programming",
    "62.02A": "IT Systems & Technology Consulting",
    "62.02B": "IT Infrastructure Support & Maintenance",
    "62.09Z": "Other IT & Computer Services",
    "63.11Z": "Data Processing, Cloud Hosting & Web Services",
    "63.12Z": "Web Portals & Search Platforms",
    
    # Section K - Financial & Insurance Activities
    "64.19Z": "Commercial Banks & Monetary Intermediation",
    "64.20Z": "Holding Companies & Financial Management",
    "66.19B": "Loan & Mortgage Brokerage Services",
    "66.22Z": "Insurance Brokerage & Agency Services",
    
    # Section L - Real Estate Activities
    "68.10Z": "Real Estate Dealers & Property Trading",
    "68.20A": "Rental & Leasing of Residential Apartments",
    "68.20B": "Rental & Leasing of Commercial Property & Land",
    "68.31Z": "Real Estate Agencies & Brokerages",
    "68.32A": "Property Management & Condominium Syndics",
    "68.32B": "Real Estate Asset Holding Structures",
    
    # Section M - Professional, Scientific & Technical Services
    "69.10Z": "Legal Activities (Lawyers, Notaries, Legal Counsel)",
    "69.20Z": "Accounting, Bookkeeping & Audit Services",
    "70.10Z": "Corporate Headquarters & Regional Offices",
    "70.22Z": "Business Management & Strategy Consulting",
    "71.11Z": "Architectural Consulting & Design",
    "71.12B": "Engineering & Technical Consulting",
    "73.11Z": "Advertising & Marketing Agencies",
    "74.10Z": "Specialized Industrial & Graphic Design",
    "74.20Z": "Commercial Photography & Media Production",
    "74.30Z": "Translation & Interpretation Services",
    
    # Section N - Administrative & Support Services
    "77.11A": "Short-Term Car & Light Vehicle Rental",
    "78.10Z": "Employment Placement & Staffing Agencies",
    "78.20Z": "Temporary Employment Services",
    "81.10Z": "Combined Facilities Support & Building Management",
    "81.21Z": "Commercial & Residential Building Cleaning",
    "81.22Z": "Specialized & Industrial Cleaning Services",
    "81.30Z": "Landscape Architecture & Gardening Services",
    "82.11Z": "Combined Office Administrative Services",
    
    # Section P - Education
    "85.51Z": "Sports & Recreation Education & Coaching",
    "85.53Z": "Driving Schools & Driver Training",
    "85.59A": "Adult Continuing Education & Professional Training",
    "85.59B": "Other Specialized Educational Instruction",
    
    # Section Q - Human Health & Social Work
    "86.21Z": "General Practice Medical Clinics",
    "86.22A": "Diagnostic Imaging & Radiotherapy Centers",
    "86.22C": "Specialist Medical Practice",
    "86.23Z": "Dental Practice & Clinics",
    "86.90A": "Ambulance & Patient Transport Services",
    "86.90D": "Nursing & Midwifery Care",
    "86.90E": "Physiotherapy & Physical Rehabilitation",
    "86.90F": "Other Healthcare & Allied Health Services",
    
    # Section R - Arts, Entertainment & Recreation
    "90.01Z": "Live Performing Arts & Theaters",
    "90.03A": "Visual Arts & Fine Arts Creation",
    "90.03B": "Other Artistic & Creative Writing Services",
    "93.12Z": "Sports Clubs & Athletic Associations",
    "93.13Z": "Fitness Centers & Gyms",
    
    # Section S - Other Personal Services
    "96.02A": "Hairdressing & Barber Salons",
    "96.02B": "Beauty Salons & Esthetic Care",
    "96.04Z": "Physical Wellbeing & Spa Services",
    "96.09Z": "Other Personal Services"
}


def get_naf_label_en(code: str) -> str:
    """Return descriptive English label for a NAF code or fallback."""
    if not code:
        return "Unspecified Activity"
    code_clean = code.strip().upper()
    return NAF_LABELS_EN.get(code_clean, f"Activity {code_clean}")
