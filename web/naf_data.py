"""
NAF (Nomenclature d'Activités Française) descriptions dictionary
for top economic activities in France.
"""

NAF_LABELS = {
    # Section A - Agriculture, sylviculture et pêche
    "01.11Z": "Culture de céréales, légumineuses et graines oléagineuses",
    "01.21Z": "Culture de la vigne",
    "01.41Z": "Élevage de vaches laitières",
    "01.42Z": "Élevage d'autres bovins et de buffles",
    "02.20Z": "Exploitation forestière",
    "03.11Z": "Pêche en mer",
    
    # Section C - Industrie manufacturière
    "10.71A": "Fabrication industrielle de pain et de pâtisserie",
    "10.71C": "Boulangerie et boulangerie-pâtisserie artisanale",
    "10.71D": "Pâtisserie",
    "10.89Z": "Fabrication d'autres produits alimentaires",
    "11.02B": "Vinification",
    "23.63Z": "Fabrication de béton prêt à l'emploi",
    "25.11Z": "Fabrication de structures métalliques et de parties de structures",
    "25.62B": "Mécanique industrielle",
    "31.09B": "Fabrication d'autres meubles et industries connexes de l'ameublement",
    "33.12Z": "Réparation de machines et équipements mécaniques",
    
    # Section F - Construction
    "41.10A": "Promotion immobilière de logements",
    "41.10D": "Supports juridiques de programmes",
    "41.20A": "Construction de maisons individuelles",
    "41.20B": "Construction d'autres bâtiments",
    "43.11Z": "Travaux de démolition",
    "43.12A": "Travaux de terrassement courants et travaux préparatoires",
    "43.21A": "Travaux d'installation électrique dans tous locaux",
    "43.22A": "Travaux d'installation d'eau et de gaz en tous locaux",
    "43.22B": "Travaux d'installation d'équipements thermiques et de climatisation",
    "43.31Z": "Travaux de plâtrerie",
    "43.32A": "Travaux de menuiserie bois et PVC",
    "43.33Z": "Travaux de revêtement des sols et des murs",
    "43.34Z": "Travaux de peinture et vitrerie",
    "43.91A": "Travaux de charpente",
    "43.91B": "Travaux de couverture par éléments",
    "43.99C": "Travaux de maçonnerie générale et gros œuvre de bâtiment",
    
    # Section G - Commerce
    "45.11Z": "Commerce de voitures et de véhicules automobiles légers",
    "45.20A": "Entretien et réparation de véhicules automobiles légers",
    "45.31Z": "Commerce de gros d'équipements automobiles",
    "46.73A": "Commerce de gros de bois et de matériaux de construction",
    "47.11A": "Commerce de détail de produits surgelés",
    "47.11B": "Commerce d'alimentation générale",
    "47.11D": "Supermarchés",
    "47.11F": "Hypermarchés",
    "47.22Z": "Commerce de détail de viandes et de produits à base de viande",
    "47.24Z": "Commerce de détail de pain, pâtisserie et confiserie",
    "47.71Z": "Commerce de détail d'habillement en magasin spécialisé",
    "47.73Z": "Commerce de détail de produits pharmaceutiques en magasin spécialisé",
    "47.91A": "Vente à distance sur catalogue général",
    "47.91B": "Vente à distance sur catalogue spécialisé (E-commerce)",
    
    # Section H - Transports et entreposage
    "49.32Z": "Transports de voyageurs par taxis et VTC",
    "49.41A": "Transports routiers de fret interurbains",
    "49.41B": "Transports routiers de fret de proximité",
    "52.21Z": "Services auxiliaires des transports terrestres",
    "53.20Z": "Autres activités de poste et de courrier (Livraison)",
    
    # Section I - Hébergement et restauration
    "55.10Z": "Hôtels et hébergement similaire",
    "55.20Z": "Hébergement touristique et autre hébergement de courte durée",
    "56.10A": "Restauration traditionnelle",
    "56.10B": "Cafétérias et autres libres-services",
    "56.10C": "Restauration de type rapide (Fast food)",
    "56.21Z": "Services des traiteurs",
    "56.30Z": "Débits de boissons (Bars, Cafés)",
    
    # Section J - Information et communication
    "58.11Z": "Édition de livres",
    "58.29C": "Édition de logiciels applicatifs",
    "62.01Z": "Programmation informatique (Tech & Dev)",
    "62.02A": "Conseil en systèmes et logiciels informatiques",
    "62.02B": "Tierce maintenance de systèmes et d'applications informatiques",
    "62.09Z": "Autres activités informatiques",
    "63.11Z": "Traitement de données, hébergement et activités connexes (Cloud)",
    "63.12Z": "Portails Internet",
    
    # Section K - Activités financières et d'assurance
    "64.19Z": "Autres intermédiations monétaires (Banques)",
    "64.20Z": "Activités des sociétés holding",
    "66.19B": "Courtage en opérations de banque et en services de paiement",
    "66.22Z": "Activités des agents et courtiers d'assurances",
    
    # Section L - Activités immobilières
    "68.10Z": "Activités des marchands de biens immobiliers",
    "68.20A": "Location de logements",
    "68.20B": "Location de terrains et d'autres biens immobiliers",
    "68.31Z": "Agences immobilières",
    "68.32A": "Administration d'immeubles et autres biens immobiliers (Syndics)",
    "68.32B": "Supports juridiques de gestion de patrimoine immobilier",
    
    # Section M - Activités spécialisées, scientifiques et techniques
    "69.10Z": "Activités juridiques (Avocats, Notaires)",
    "69.20Z": "Activités comptables et d'expertise",
    "70.10Z": "Activités des sièges sociaux",
    "70.22Z": "Conseil pour les affaires et autres conseils de gestion",
    "71.11Z": "Activités d'architecture",
    "71.12B": "Ingénierie, études techniques",
    "73.11Z": "Activités des agences de publicité",
    "74.10Z": "Activités spécialisées de design",
    "74.20Z": "Activités photographiques",
    "74.30Z": "Traduction et interprétation",
    
    # Section N - Services administratifs et de soutien
    "77.11A": "Location de courte durée de voitures et véhicules automobiles",
    "78.10Z": "Activités des agences de placement de main-d'œuvre",
    "78.20Z": "Activités des agences de travail temporaire (Intérim)",
    "81.10Z": "Services combinés de soutien lié aux bâtiments (Gestion de copropriétés)",
    "81.21Z": "Nettoyage courant des bâtiments",
    "81.22Z": "Autres activités de nettoyage des bâtiments et nettoyage industriel",
    "81.30Z": "Services d'aménagement paysager (Jardiniers)",
    "82.11Z": "Services administratifs combinés de bureau",
    
    # Section P - Enseignement
    "85.51Z": "Enseignement de disciplines sportives et d'activités de loisirs",
    "85.53Z": "Enseignement de la conduite (Auto-écoles)",
    "85.59A": "Formation continue d'adultes",
    "85.59B": "Autres enseignements",
    
    # Section Q - Santé humaine et action sociale
    "86.21Z": "Activité des médecins généralistes",
    "86.22A": "Activités de radiodiagnostic et de radiothérapie",
    "86.22C": "Autre activité des médecins spécialistes",
    "86.23Z": "Pratique dentaire",
    "86.90A": "Ambulances",
    "86.90D": "Activités des infirmiers et des sages-femmes",
    "86.90E": "Activités des professionnels de la rééducation (Kinésithérapie)",
    "86.90F": "Activités de santé humaine non classées ailleurs",
    
    # Section R - Arts, spectacles et activités récréatives
    "90.01Z": "Arts du spectacle vivant",
    "90.03A": "Création artistique relevant des arts plastiques",
    "90.03B": "Autre création artistique",
    "93.12Z": "Activités de clubs de sports",
    "93.13Z": "Activités des centres de culture physique (Fitness)",
    
    # Section S - Autres activités de services
    "96.02A": "Coiffure",
    "96.02B": "Soins de beauté (Instituts d'esthétique)",
    "96.04Z": "Entretien corporel",
    "96.09Z": "Autres services personnels n.c.a."
}


def get_naf_label(code: str) -> str:
    """Return descriptive label for a NAF code or fallback."""
    if not code:
        return "Non spécifié"
    code_clean = code.strip().upper()
    return NAF_LABELS.get(code_clean, f"Activité {code_clean}")
