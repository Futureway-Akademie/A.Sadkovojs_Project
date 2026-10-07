// Fictional customers, sites and texts for the demo seed. Any resemblance to real companies is unintended.

export const COMPANY_PREFIXES = [
  "Rheinauer", "Niederrhein", "Ruhrtal", "Bergische", "Westfalen", "Lippe", "Erft", "Wupper", "Emscher", "Sauerland",
  "Volme", "Kaiserswerther", "Hafen", "Nordstern", "Lenne", "Agger", "Sieg", "Eifel", "Kempener", "Moerser",
];
export const COMPANY_CORES = [
  "Kunststofftechnik", "Lebensmittelwerke", "Metallverarbeitung", "Papierfabrik", "Getränke", "Chemiepark Service",
  "Galvanik", "Brauerei", "Druckerei", "Logistikzentrum", "Molkerei", "Präzisionsteile", "Klinikum Technik",
  "Stadtwerke Betrieb", "Gießerei", "Verpackungen", "Textilveredelung", "Kältetechnik", "Recycling", "Glaswerk",
];
export const COMPANY_FORMS = ["GmbH", "GmbH & Co. KG", "AG", "KG", "GmbH"];

export const CITIES = [
  ["40210", "Düsseldorf"], ["40474", "Düsseldorf"], ["41460", "Neuss"], ["47051", "Duisburg"], ["47798", "Krefeld"],
  ["45127", "Essen"], ["44135", "Dortmund"], ["42103", "Wuppertal"], ["50667", "Köln"], ["50999", "Köln"],
  ["41061", "Mönchengladbach"], ["40721", "Hilden"], ["42651", "Solingen"], ["46045", "Oberhausen"], ["45468", "Mülheim an der Ruhr"],
  ["51373", "Leverkusen"], ["40822", "Mettmann"], ["47441", "Moers"], ["41515", "Grevenbroich"], ["40880", "Ratingen"],
];
export const STREETS = [
  "Industriestraße", "Am Hafen", "Gewerbering", "Werkstraße", "Hansaallee", "Im Schiffahrtshafen", "Carl-Benz-Straße",
  "Max-Planck-Ring", "Kanalstraße", "Siemensstraße", "Am Bahnhof", "Robert-Bosch-Straße", "Fabrikweg", "Lagerstraße",
];
export const SITE_LABELS = ["Werk 1", "Werk 2", "Halle A", "Halle C", "Technikzentrale", "Kesselhaus", "Abfüllung", "Lager Nord"];

export const FIRST_NAMES = [
  "Sabine", "Thomas", "Katrin", "Michael", "Julia", "Stefan", "Nicole", "Andreas", "Melanie", "Frank",
  "Petra", "Markus", "Sandra", "Christian", "Birgit", "Oliver", "Yasemin", "Piotr", "Elena", "Kemal",
];
export const LAST_NAMES = [
  "Schulz", "Meyer", "Fischer", "Weber", "Schäfer", "Koch", "Bauer", "Richter", "Klein", "Wolf",
  "Neumann", "Schwarz", "Zimmermann", "Braun", "Hartmann", "Krause", "Lange", "Werner", "Arslan", "Kowalski",
];

export const MANUFACTURERS = {
  pump: ["Aquaflux", "Hydrotec", "Pumpenwerk Nord", "Fluvio"],
  compressor: ["Druckluft Kessler", "Aerocomp", "Kompressa", "AirLine"],
  ventilation: ["Ventara", "Klimabau West", "Luftwerk", "Aeris"],
  other: ["Anlagenbau Rhein", "Technik Hoffmann", "Fördertechnik Ost"],
};

export const DESCRIPTIONS = {
  diagnosis_repair: {
    pump: ["Pumpe verliert Wasser an der Gleitringdichtung.", "Kreiselpumpe läuft laut und vibriert stark.", "Förderleistung deutlich gesunken, Druck schwankt.", "Motorschutzschalter löst nach wenigen Minuten aus."],
    compressor: ["Kompressor schaltet unregelmäßig ab, Öltemperatur hoch.", "Druckluftanlage erreicht den Solldruck nicht mehr.", "Ölaustrag im Druckluftnetz festgestellt.", "Lautes Klopfen beim Anlauf des Verdichters."],
    ventilation: ["Lüftungsanlage meldet Störung am Ventilator.", "Zuluft deutlich reduziert, Filteralarm dauerhaft.", "Keilriemen quietscht, Anlage vibriert.", "Wärmerückgewinnung ohne Funktion."],
    other: ["Fördereinrichtung bleibt sporadisch stehen.", "Hydraulikaggregat verliert Druck.", "Steuerung meldet wiederkehrende Fehlercodes."],
  },
  scheduled_maintenance: {
    pump: ["Jährliche Wartung der Pumpenstation fällig.", "Wartung laut Wartungsplan, drei Pumpen."],
    compressor: ["Wartung nach 4.000 Betriebsstunden.", "Jahreswartung Schraubenkompressor inkl. Ölwechsel."],
    ventilation: ["Halbjährliche Wartung der Lüftungsanlage mit Filterwechsel.", "Wartung RLT-Anlage vor der Sommersaison."],
    other: ["Wartung der Hydraulikeinheit gemäß Herstellervorgabe."],
  },
  inspection: {
    pump: ["Inspektion der Pumpen vor Produktionsumstellung.", "Zustandsprüfung nach Hochwasser im Keller."],
    compressor: ["Prüfung der Druckluftanlage für das Audit.", "Sichtprüfung und Leckageortung im Druckluftnetz."],
    ventilation: ["Hygieneinspektion der Lüftungsanlage.", "Inspektion vor Abnahme durch den Versicherer."],
    other: ["Allgemeine Inspektion der technischen Anlagen."],
  },
};

export const PARTS = {
  pump: [["Gleitringdichtung", 48], ["Laufrad", 186], ["Wälzlagersatz", 72], ["O-Ring-Satz", 14]],
  compressor: [["Ölabscheider", 96], ["Luftfilterelement", 38], ["Ansaugregler-Reparatursatz", 142], ["Keilriemen", 29]],
  ventilation: [["Taschenfilter F7", 34], ["Keilriemen", 29], ["Ventilatorlager", 64], ["Stellantrieb", 158]],
  other: [["Hydraulikschlauch", 57], ["Näherungsschalter", 43], ["Dichtungssatz", 22]],
};

export const SUMMARIES = {
  diagnosis_repair: ["Fehler behoben, Probelauf ohne Befund.", "Defektes Bauteil ersetzt, Anlage läuft stabil.", "Ursache gefunden und instand gesetzt, Kunde eingewiesen."],
  scheduled_maintenance: ["Wartung nach Plan durchgeführt, keine Mängel.", "Wartung erledigt, Verschleißteile im nächsten Intervall prüfen."],
  inspection: ["Inspektion durchgeführt, Prüfbericht übergeben.", "Inspektion ohne Mängel abgeschlossen."],
};

export const REJECTION_REASONS = [
  "Privathaushalt, kein Industriekunde.",
  "Anlage eines Fremdherstellers außerhalb unseres Leistungsspektrums.",
  "Einsatzort außerhalb des Servicegebiets.",
];
export const CANCELLATION_REASONS = [
  "Kunde hat den Auftrag storniert.",
  "Störung hat sich durch Eigenleistung des Kunden erledigt.",
  "Anlage wird stillgelegt.",
];
export const UNCERTAINTIES = [
  "Typenschildangaben fehlen.",
  "Unklar, ob die Anlage unter Druck steht.",
  "Widersprüchliche Angaben zu Hersteller und Modell.",
  "Sicherheitsgefahr als „Unklar“ angegeben.",
];
