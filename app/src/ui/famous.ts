/** Curated famous routes per area: point-to-point routes, crawls and workouts. */
import type { ModeId } from "../modes/modes";
import type { CrawlTheme, WorkoutFocus } from "../modes/options";

interface FamousBase {
  title: string;
  pitch: string;
  from: [number, number];
  fromName: string;
}

export interface FamousPlan extends FamousBase {
  kind: "plan";
  mode: ModeId;
  seed: number;
  to: [number, number];
  toName: string;
}

export interface FamousCrawl extends FamousBase {
  kind: "crawl";
  theme: CrawlTheme;
  count: number;
  minutes: number;
}

export interface FamousWorkout extends FamousBase {
  kind: "workout";
  focus: WorkoutFocus;
  minutes: number;
}

export type FamousRoute = FamousPlan | FamousCrawl | FamousWorkout;

const LYON: readonly FamousRoute[] = [
  {
    kind: "plan",
    title: "Fourvière by Stairs",
    pitch: "Cathedral to basilica by the staircases. Several hundred steps, nearly all up.",
    mode: "stairs", seed: 1,
    from: [4.8274, 45.7606], fromName: "Cathédrale Saint-Jean",
    to: [4.8225, 45.7623], toName: "Basilique de Fourvière",
  },
  {
    kind: "plan",
    title: "Through the Pentes",
    pitch: "Up the Croix-Rousse slopes through whatever public passages are mapped.",
    mode: "buildings", seed: 1,
    from: [4.8336, 45.7675], fromName: "Place des Terreaux",
    to: [4.8317, 45.7745], toName: "Place de la Croix-Rousse",
  },
  {
    kind: "plan",
    title: "The Pentes, Upwards",
    pitch: "The same hill, by its staircases.",
    mode: "stairs", seed: 1,
    from: [4.8336, 45.7675], fromName: "Place des Terreaux",
    to: [4.8317, 45.7745], toName: "Place de la Croix-Rousse",
  },
  {
    kind: "plan",
    title: "Park to Park",
    pitch: "From the Tête d'Or to Bellecour without leaving the greenery for long.",
    mode: "parks", seed: 1,
    from: [4.8519, 45.7703], fromName: "Parc de la Tête d'Or",
    to: [4.832, 45.7578], toName: "Place Bellecour",
  },
  {
    kind: "plan",
    title: "The Croissant Route",
    pitch: "Bellecour to the Terreaux past as many bakeries as fit.",
    mode: "snacks", seed: 1,
    from: [4.832, 45.7578], fromName: "Place Bellecour",
    to: [4.8336, 45.7675], toName: "Place des Terreaux",
  },
  {
    kind: "plan",
    title: "Jean Macé, Unpaved",
    pitch: "Jean Macé to Bellecour on as little pavement as Lyon allows.",
    mode: "trail", seed: 1,
    from: [4.8424, 45.7457], fromName: "Place Jean Macé",
    to: [4.832, 45.7578], toName: "Place Bellecour",
  },
  {
    kind: "plan",
    title: "Left to Bellecour",
    pitch: "Jean Macé to Bellecour without turning right.",
    mode: "no-right", seed: 1,
    from: [4.8424, 45.7457], fromName: "Place Jean Macé",
    to: [4.832, 45.7578], toName: "Place Bellecour",
  },
  {
    kind: "plan",
    title: "Seed 42",
    pitch: "Part-Dieu to Vieux Lyon, routed by the number 42.",
    mode: "chaos", seed: 42,
    from: [4.8593, 45.7606], fromName: "Gare Part-Dieu",
    to: [4.8274, 45.7606], toName: "Cathédrale Saint-Jean",
  },
  {
    kind: "plan",
    title: "Terreaux, Eventually",
    pitch: "Bellecour to the Terreaux the most annoying reasonable way. No extra busy roads.",
    mode: "inconvenient", seed: 1,
    from: [4.832, 45.7578], fromName: "Place Bellecour",
    to: [4.8336, 45.7675], toName: "Place des Terreaux",
  },
  {
    kind: "crawl",
    title: "Croix-Rousse Art Loop",
    pitch: "Murals, sculptures and pavement mosaics around the Croix-Rousse, back where you started.",
    theme: "art", count: 6, minutes: 45,
    from: [4.8317, 45.7745], fromName: "Place de la Croix-Rousse",
  },
  {
    kind: "workout",
    title: "Fourvière Stair Loop",
    pitch: "Half an hour of the Vieux Lyon staircases, starting and ending at the cathedral.",
    focus: "stairs", minutes: 30,
    from: [4.8274, 45.7606], fromName: "Cathédrale Saint-Jean",
  },
];

const DC: readonly FamousRoute[] = [
  {
    kind: "plan",
    title: "The Exorcist Steps, Upwards",
    pitch: "From the Georgetown waterfront up to Dumbarton Oaks by every staircase going, including the famous one.",
    mode: "stairs", seed: 1,
    from: [-77.0625, 38.9025], fromName: "Georgetown Waterfront Park",
    to: [-77.0636, 38.9149], toName: "Dumbarton Oaks",
  },
  {
    kind: "plan",
    title: "Memorials, the Green Way",
    pitch: "Lincoln Memorial to the Capitol through as many parks and gardens as fit.",
    mode: "parks", seed: 1,
    from: [-77.0502, 38.8893], fromName: "Lincoln Memorial",
    to: [-77.0091, 38.8899], toName: "United States Capitol",
  },
  {
    kind: "plan",
    title: "Circle to Circle, Leftwards",
    pitch: "Dupont Circle to Logan Circle without turning right.",
    mode: "no-right", seed: 1,
    from: [-77.0434, 38.9096], fromName: "Dupont Circle",
    to: [-77.0297, 38.9096], toName: "Logan Circle",
  },
  {
    kind: "crawl",
    title: "U Street Murals",
    pitch: "Murals around U Street and Shaw, looping back to the Metro.",
    theme: "art", count: 6, minutes: 45,
    from: [-77.0285, 38.917], fromName: "U Street station",
  },
  {
    kind: "plan",
    title: "Union Station, Eventually",
    pitch: "Eastern Market to Union Station the most annoying reasonable way. No extra busy roads.",
    mode: "inconvenient", seed: 1,
    from: [-76.9963, 38.8865], fromName: "Eastern Market",
    to: [-77.0063, 38.8973], toName: "Union Station",
  },
];

const ARLINGTON: readonly FamousRoute[] = [
  {
    kind: "plan",
    title: "Rosslyn to Clarendon, Green Way",
    pitch: "Along the Orange Line corridor through as many parks as fit.",
    mode: "parks", seed: 1,
    from: [-77.0712, 38.8966], fromName: "Rosslyn",
    to: [-77.0953, 38.8868], toName: "Clarendon",
  },
  {
    kind: "plan",
    title: "King Street Snacks",
    pitch: "Old Town Alexandria from the Metro to the waterfront, past the bakeries and cafés.",
    mode: "snacks", seed: 1,
    from: [-77.0596, 38.8063], fromName: "King Street–Old Town station",
    to: [-77.0396, 38.8048], toName: "Alexandria waterfront",
  },
];

const BALTIMORE: readonly FamousRoute[] = [
  {
    kind: "plan",
    title: "Federal Hill, the Steep Way",
    pitch: "From the Inner Harbor up Federal Hill by its staircases.",
    mode: "stairs", seed: 1,
    from: [-76.6105, 39.2856], fromName: "Inner Harbor",
    to: [-76.6086, 39.2795], toName: "Federal Hill Park",
  },
  {
    kind: "crawl",
    title: "Fells Point Pubs",
    pitch: "A short evening loop through the pubs of Fells Point.",
    theme: "pub", count: 4, minutes: 30,
    from: [-76.5933, 39.2823], fromName: "Fells Point",
  },
];

const RICHMOND: readonly FamousRoute[] = [
  {
    kind: "plan",
    title: "Up to Libby Hill",
    pitch: "Shockoe Bottom to Libby Hill Park by the Church Hill staircases.",
    mode: "stairs", seed: 1,
    from: [-77.4325, 37.5323], fromName: "Shockoe Bottom",
    to: [-77.4207, 37.5285], toName: "Libby Hill Park",
  },
  {
    kind: "crawl",
    title: "Murals of the Fan",
    pitch: "A loop through Richmond's murals, starting at Monroe Park.",
    theme: "art", count: 6, minutes: 45,
    from: [-77.4502, 37.5468], fromName: "Monroe Park",
  },
];

const SILVER_SPRING: readonly FamousRoute[] = [
  {
    kind: "crawl",
    title: "Downtown Silver Spring Art",
    pitch: "Public art around downtown Silver Spring, back to the Metro.",
    theme: "art", count: 5, minutes: 45,
    from: [-77.0311, 38.9939], fromName: "Silver Spring station",
  },
];

const CHICAGO: readonly FamousRoute[] = [
  {
    kind: "plan",
    title: "Down to the Riverwalk",
    pitch: "Along the river from the Merchandise Mart to Michigan Avenue, by every staircase between the bridges and the Riverwalk.",
    mode: "stairs", seed: 1,
    from: [-87.6355, 41.8885], fromName: "Merchandise Mart",
    to: [-87.6245, 41.8887], toName: "DuSable Bridge",
  },
  {
    kind: "plan",
    title: "Under the Loop",
    pitch: "Millennium Station to Daley Plaza through the Loop's buildings, with a stretch of the Pedway.",
    mode: "buildings", seed: 1,
    from: [-87.6245, 41.8846], fromName: "Millennium Station",
    to: [-87.6301, 41.8840], toName: "Daley Plaza",
  },
  {
    kind: "plan",
    title: "Grant Park to the Museums",
    pitch: "Cloud Gate to the Field Museum through as many parks as fit.",
    mode: "parks", seed: 1,
    from: [-87.6233, 41.8827], fromName: "Cloud Gate",
    to: [-87.6170, 41.8663], toName: "Field Museum",
  },
  {
    kind: "plan",
    title: "Rogers Park Beaches",
    pitch: "Loyola to Howard by the string of little lakefront parks and beaches.",
    mode: "parks", seed: 1,
    from: [-87.6612, 42.0010], fromName: "Loyola station",
    to: [-87.6729, 42.0190], toName: "Howard station",
  },
  {
    kind: "plan",
    title: "Andersonville Sweets",
    pitch: "Berwyn station to Clark and Bryn Mawr, past Andersonville's cafés.",
    mode: "snacks", seed: 1,
    from: [-87.6588, 41.9779], fromName: "Berwyn station",
    to: [-87.6681, 41.9835], toName: "Clark and Bryn Mawr",
  },
  {
    kind: "workout",
    title: "Riverwalk Stair Laps",
    pitch: "A short loop up and down the staircases between Wacker Drive and the Riverwalk.",
    focus: "stairs", minutes: 30,
    from: [-87.6278, 41.8873], fromName: "Riverwalk at State Street",
  },
  {
    kind: "crawl",
    title: "Loop Public Art",
    pitch: "Picasso, Chagall, Calder and friends: a loop through the Loop's public art from Daley Plaza.",
    theme: "art", count: 6, minutes: 45,
    from: [-87.6301, 41.8840], fromName: "Daley Plaza",
  },
  {
    kind: "crawl",
    title: "Andersonville Pubs",
    pitch: "A short evening loop through Andersonville's pubs and bars.",
    theme: "pub", count: 4, minutes: 30,
    from: [-87.6683, 41.9760], fromName: "Clark and Foster",
  },
  {
    kind: "crawl",
    title: "Ravenswood Breweries and Bars",
    pitch: "From the Damen Brown Line stop through Ravenswood's taprooms and bars.",
    theme: "pub", count: 4, minutes: 45,
    from: [-87.6785, 41.9662], fromName: "Damen station (Brown Line)",
  },
];

const COPENHAGEN: readonly FamousRoute[] = [
  {
    kind: "plan",
    title: "City Hall to Østerport, by Parks",
    pitch: "Rådhuspladsen to Østerport through Ørstedsparken, the Botanical Garden and the King's Garden.",
    mode: "parks", seed: 1,
    from: [12.5683, 55.6761], fromName: "Rådhuspladsen",
    to: [12.5878, 55.6926], toName: "Østerport station",
  },
  {
    kind: "plan",
    title: "Through the Courtyards",
    pitch: "Kongens Nytorv to Nørreport through the old town's passages and courtyards.",
    mode: "buildings", seed: 1,
    from: [12.5855, 55.6803], fromName: "Kongens Nytorv",
    to: [12.5717, 55.6833], toName: "Nørreport station",
  },
  {
    kind: "plan",
    title: "Across Amager Fælled",
    pitch: "Islands Brygge to Ørestad on the common's gravel and dirt paths.",
    mode: "trail", seed: 1,
    from: [12.5770, 55.6640], fromName: "Islands Brygge",
    to: [12.5770, 55.6380], toName: "Ørestad",
  },
  {
    kind: "plan",
    title: "Nørrebro Pastries",
    pitch: "Torvehallerne to Jægersborggade, past as many bakeries as fit.",
    mode: "snacks", seed: 1,
    from: [12.5697, 55.6836], fromName: "Torvehallerne",
    to: [12.5463, 55.6935], toName: "Jægersborggade",
  },
  {
    kind: "crawl",
    title: "Old Town Art",
    pitch: "Sculptures and galleries around the old town, back to Kongens Nytorv.",
    theme: "art", count: 6, minutes: 45,
    from: [12.5855, 55.6803], fromName: "Kongens Nytorv",
  },
  {
    kind: "crawl",
    title: "Kødbyen and Vesterbro Bars",
    pitch: "A short evening loop from the Meatpacking District through Vesterbro's bars.",
    theme: "pub", count: 4, minutes: 30,
    from: [12.5605, 55.6691], fromName: "Kødbyen",
  },
  {
    kind: "crawl",
    title: "Nørrebro Wine",
    pitch: "Wine bars and shops around Jægersborggade and the lakes.",
    theme: "wine", count: 4, minutes: 45,
    from: [12.5463, 55.6935], fromName: "Jægersborggade",
  },
];

const MALMO: readonly FamousRoute[] = [
  {
    kind: "plan",
    title: "Castle Parks to the Sea",
    pitch: "Gustav Adolfs torg to the Ribersborg bathhouse through Kungsparken, Slottsparken and a string of smaller parks.",
    mode: "parks", seed: 1,
    from: [13.0011, 55.6022], fromName: "Gustav Adolfs torg",
    to: [12.9790, 55.6060], toName: "Ribersborgs kallbadhus",
  },
  {
    kind: "plan",
    title: "Turning Torso to the Beach",
    pitch: "Through Västra Hamnen to Ribersborg on the softest paths going.",
    mode: "trail", seed: 1,
    from: [12.9764, 55.6133], fromName: "Turning Torso",
    to: [12.9645, 55.6010], toName: "Ribersborgsstranden",
  },
  {
    kind: "plan",
    title: "Fika Run",
    pitch: "Malmö C to Möllevångstorget, past the cafés and bakeries.",
    mode: "snacks", seed: 1,
    from: [13.0006, 55.6091], fromName: "Malmö C",
    to: [13.0105, 55.5905], toName: "Möllevångstorget",
  },
  {
    kind: "crawl",
    title: "Gamla staden Art",
    pitch: "Public art around the old town, back to Stortorget.",
    theme: "art", count: 5, minutes: 45,
    from: [13.0010, 55.6058], fromName: "Stortorget",
  },
  {
    kind: "crawl",
    title: "Möllan Pubs",
    pitch: "A short evening loop through the pubs around Möllevångstorget.",
    theme: "pub", count: 4, minutes: 30,
    from: [13.0105, 55.5905], fromName: "Möllevångstorget",
  },
];

const NEWBERG: readonly FamousRoute[] = [
  {
    kind: "plan",
    title: "Hoover Park to Spring Meadow",
    pitch: "From downtown across Newberg through four of its parks.",
    mode: "parks", seed: 1,
    from: [-122.9718, 45.3006], fromName: "Downtown Newberg",
    to: [-122.9375, 45.3108], toName: "Spring Meadow Park",
  },
  {
    kind: "plan",
    title: "George Fox by Stairs",
    pitch: "Downtown up to George Fox University by the campus staircases.",
    mode: "stairs", seed: 1,
    from: [-122.9718, 45.3006], fromName: "Downtown Newberg",
    to: [-122.9660, 45.3085], toName: "George Fox University",
  },
  {
    kind: "workout",
    title: "North Newberg Hills",
    pitch: "A short loop up the slopes around George Fox.",
    focus: "hills", minutes: 30,
    from: [-122.9675, 45.3075], fromName: "George Fox University",
  },
];

const DUNDEE: readonly FamousRoute[] = [
  {
    kind: "crawl",
    title: "Dundee Tasting Rooms",
    pitch: "A short loop through three of the tasting rooms and wine shops in town.",
    theme: "wine", count: 3, minutes: 45,
    from: [-123.0103, 45.2779], fromName: "Downtown Dundee",
  },
  {
    kind: "workout",
    title: "Into the Dundee Hills",
    pitch: "A loop up the first slopes of the Dundee Hills and back.",
    focus: "hills", minutes: 45,
    from: [-123.0103, 45.2779], fromName: "Downtown Dundee",
  },
];


/** Famous routes for each area id (areas without any show an empty list). */
export const FAMOUS: Readonly<Record<string, readonly FamousRoute[]>> = {
  lyon: LYON,
  dc: DC,
  arlington: ARLINGTON,
  "silver-spring": SILVER_SPRING,
  richmond: RICHMOND,
  baltimore: BALTIMORE,
  chicago: CHICAGO,
  newberg: NEWBERG,
  dundee: DUNDEE,
  copenhagen: COPENHAGEN,
  malmo: MALMO,
};

/** Lyon's list, kept under its old name for tests and benches. */
export const FAMOUS_ROUTES = LYON;
